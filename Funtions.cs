using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Text.Json;
public class SubmissionPayload
{
    public string Name { get; set; } = string.Empty;
}

public class Functions
{
    private readonly AppDbContext _context;

    public Functions(AppDbContext context)
    {
        _context = context;
    }

    [Function("HandleMissionForm")]
    public async Task<HttpResponseData> HandleMissionSubmission(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "missions")]
        HttpRequestData req)
    {
        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        SubmissionPayload? data;

        try
        {
            data = JsonSerializer.Deserialize<SubmissionPayload>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException ex)
        {
            Console.WriteLine($"JSON Deserialization Error: {ex.Message}");
            var badRequestResponse = req.CreateResponse(HttpStatusCode.BadRequest);
            await badRequestResponse.WriteStringAsync($"Invalid JSON format: {ex.Message}");
            return badRequestResponse;
        }

        if (data == null || string.IsNullOrWhiteSpace(data.Name))
        {
            var badRequestResponse = req.CreateResponse(HttpStatusCode.BadRequest);
            await badRequestResponse.WriteStringAsync("Name field is required in the JSON payload.");
            return badRequestResponse;
        }

        try
        {
            await _context.Database.ExecuteSqlRawAsync(
                "EXEC dbo.AddFormSubmission @Name = {0}",
                data.Name
            );

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteStringAsync($"Successfully stored '{data.Name}' in the database via stored procedure!");
            return response;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error saving to database: {ex.Message}");
            Console.WriteLine($"Stack Trace: {ex.StackTrace}");
            
            var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
            await errorResponse.WriteStringAsync($"Error processing your submission: {ex.Message}");
            return errorResponse;
        }
    }
}