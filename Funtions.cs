using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;

namespace Microsoft.ManagedIdentity
{
    public class Functions
    {
        private readonly AppDbContext _dbContext;

        public Functions(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        [Function("Formupload")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "formupload")]
            HttpRequestData req)
        {
            try
            {
                // Read the request body
                using var reader = new StreamReader(req.Body);
                var bodyContent = await reader.ReadToEndAsync();

                // Parse JSON body to extract the name
                var jsonBody = JsonSerializer.Deserialize<FormData>(bodyContent);
                string name = jsonBody?.Name ?? string.Empty; // Null check with fallback

                if (string.IsNullOrEmpty(name))
                {
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteStringAsync("Name is required in the request body");
                    return badResponse;
                }

                // Save to database
                var user = new User { Name = name };
                await _dbContext.Users.AddAsync(user);
                await _dbContext.SaveChangesAsync();

                // Return success response
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteStringAsync($"Name '{name}' saved successfully");
                return response;
            }
            catch (Exception ex)
            {
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }
    }

    // Class to deserialize JSON body
    public class FormData
    {
        public string Name { get; set; } = string.Empty;
    }

    // Entity class for the User table
    public class User
    {
        public int Id { get; set; } // Primary key
        public string Name { get; set; } = string.Empty;
    }

    // DbContext for Azure SQL
    public class AppDbContext : DbContext
    {
        public DbSet<User> Users { get; set; }

        public AppDbContext(DbContextOptions<AppDbContext> options)
            : base(options)
        {
        }
    }
}