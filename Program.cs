// Program.cs
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging; // ADD THIS

var host = Host.CreateDefaultBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices(services =>
    {
        // Use a transient logger builder just for a very early check if Program.cs is running
        // This is a hacky way to log if regular DI isn't working yet for the full ILogger<T>
        var serviceProvider = services.BuildServiceProvider();
        var loggerFactory = serviceProvider.GetService<ILoggerFactory>();
        var programLogger = loggerFactory?.CreateLogger("ProgramStartup");
        programLogger?.LogInformation("Program.cs: Starting host configuration."); // <-- ADD THIS

        services.AddLogging(); // Make sure this is present for Function class
        
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlServer(Environment.GetEnvironmentVariable("SqlConnectionString")));
    })
    .Build();

host.Run();