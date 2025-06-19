using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.ManagedIdentity;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults() // Correct method for Functions Worker setup
    .ConfigureServices((context, services) =>
    {
        // Retrieve connection string with null check
        string connectionString = Environment.GetEnvironmentVariable("SqlConnectionString")
            ?? throw new InvalidOperationException("SqlConnectionString environment variable not set.");

        // Configure DbContext with Azure SQL
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlServer(connectionString));
    })
    .Build();

await host.RunAsync();