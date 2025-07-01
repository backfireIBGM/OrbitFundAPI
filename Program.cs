using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Data.SqlClient;

internal class Program
{
    private static void Main(string[] args)
    {
        var host = Host.CreateDefaultBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices(services =>
    {
        var serviceProvider = services.BuildServiceProvider();
        var loggerFactory = serviceProvider.GetService<ILoggerFactory>();
        var programLogger = loggerFactory?.CreateLogger("ProgramStartup");

        programLogger?.LogInformation("Program.cs: Starting host configuration.");

        // Your existing SQL connection string environment variable might still contain server/database info.
        // We'll modify it to use Managed Identity.
        var sqlConnectionString = Environment.GetEnvironmentVariable("sql");

        if (string.IsNullOrEmpty(sqlConnectionString))
        {
            programLogger?.LogError("Program.cs: SqlConnectionString environment variable is NULL or EMPTY!");
            // Consider throwing an exception or providing a default if this is a critical dependency.
            throw new InvalidOperationException("SQL Connection string environment variable 'sql' is not set.");
        }
        else
        {
            programLogger?.LogInformation($"Program.cs: Raw SqlConnectionString from env: {sqlConnectionString.Substring(0, Math.Min(sqlConnectionString.Length, 30))}...");

            // Use SqlConnectionStringBuilder to easily modify the connection string
            // This allows you to keep the server name, database name, etc., in your environment variable.
            var builder = new SqlConnectionStringBuilder(sqlConnectionString)
            {
                // Crucial for Managed Identity authentication
                Authentication = SqlAuthenticationMethod.ActiveDirectoryManagedIdentity
                // You might also want to set Encrypt and TrustServerCertificate if not already handled
                // Encrypt = true,
                // TrustServerCertificate = false // Always set to false in production for security
            };

            var connectionStringForDb = builder.ConnectionString;
            programLogger?.LogInformation($"Program.cs: Connection string configured for Managed Identity.");
            // For debugging, you could log a partial string, but be cautious not to log sensitive details
            // programLogger?.LogInformation($"Program.cs: Final Connection String starts with: {connectionStringForDb.Substring(0, Math.Min(connectionStringForDb.Length, 60))}");

            services.AddLogging();

            services.AddDbContext<AppDbContext>(options =>
                options.UseSqlServer(connectionStringForDb)); // Use the modified connection string
        }
    })
    .Build();

        host.Run();
    }
}