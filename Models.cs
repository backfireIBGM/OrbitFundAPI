using Microsoft.EntityFrameworkCore;

public class FormSubmission
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime SubmittedAt { get; set; }
}

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
    
    public DbSet<FormSubmission> Submissions { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FormSubmission>().ToTable("FormSubmissions");
    }
}