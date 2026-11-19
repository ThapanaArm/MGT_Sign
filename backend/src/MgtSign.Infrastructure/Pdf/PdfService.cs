using System.Globalization;
using System.Reflection;
using MgtSign.Domain;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace MgtSign.Infrastructure.Pdf;

public sealed record MergedPdf(byte[] Bytes, int PageCount, string FileName);

public interface IPdfService
{
    int PageCount(byte[] pdf);
    MergedPdf Merge(IReadOnlyList<(string FileName, byte[] Bytes)> files);
    /// <summary>Draws filled field values onto the document. Adds a Certificate of Completion page when requested.</summary>
    byte[] Stamp(byte[] original, Envelope envelope, bool withCertificate);
}

/// <summary>PDF work with PDFsharp (MIT). Field values arrive as PNG data URLs or plain text.</summary>
public sealed class PdfService : IPdfService
{
    static readonly CultureInfo En = CultureInfo.GetCultureInfo("en-US");
    readonly string _font;

    public PdfService(PdfFontOptions options)
    {
        PdfFonts.EnsureRegistered(options);
        _font = PdfFonts.Family;
    }

    public int PageCount(byte[] pdf)
    {
        using var ms = new MemoryStream(pdf);
        using var doc = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
        return doc.PageCount;
    }

    public MergedPdf Merge(IReadOnlyList<(string FileName, byte[] Bytes)> files)
    {
        if (files.Count == 1) return new MergedPdf(files[0].Bytes, PageCount(files[0].Bytes), files[0].FileName);
        using var output = new PdfDocument();
        foreach (var (_, bytes) in files)
        {
            using var ms = new MemoryStream(bytes);
            using var src = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
            foreach (var p in src.Pages) output.AddPage(p);
        }
        using var outMs = new MemoryStream();
        output.Save(outMs);
        var name = string.Join(" + ", files.Select(f => Path.GetFileNameWithoutExtension(f.FileName))) + ".pdf";
        return new MergedPdf(outMs.ToArray(), output.PageCount, name);
    }

    public byte[] Stamp(byte[] original, Envelope envelope, bool withCertificate)
    {
        using var ms = new MemoryStream(original);
        using var doc = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);
        foreach (var f in envelope.Fields.Where(HasValue))
        {
            if (f.Page < 0 || f.Page >= doc.PageCount) continue;
            var page = doc.Pages[f.Page];
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            double W = page.Width.Point, H = page.Height.Point;
            var rect = new XRect(f.X * W, f.Y * H, f.Width * W, f.Height * H);
            DrawField(gfx, f, rect);
        }
        if (withCertificate) AddCertificate(doc, envelope);
        doc.Info.Title = envelope.Subject;
        doc.Info.Creator = "MGT Sign";
        doc.Info.Subject = "Envelope " + envelope.Code;
        using var outMs = new MemoryStream();
        doc.Save(outMs);
        return outMs.ToArray();
    }

    static bool HasValue(Field f) => f.Type == FieldType.Checkbox ? f.Value == "true" : !string.IsNullOrEmpty(f.Value) || !string.IsNullOrEmpty(f.RenderedImage);

    void DrawField(XGraphics gfx, Field f, XRect r)
    {
        switch (f.Type)
        {
            case FieldType.Signature or FieldType.Initial or FieldType.Stamp:
                DrawImageContain(gfx, f.Value, r); break;
            case FieldType.Checkbox:
                var pen = new XPen(XColors.Black, 0.8);
                gfx.DrawRectangle(pen, r);
                if (f.Value == "true")
                {
                    var p2 = new XPen(XColors.Black, Math.Max(1, r.Height / 9));
                    gfx.DrawLines(p2, [new XPoint(r.X + r.Width * .2, r.Y + r.Height * .55), new XPoint(r.X + r.Width * .42, r.Y + r.Height * .78), new XPoint(r.X + r.Width * .82, r.Y + r.Height * .25)]);
                }
                break;
            default:
                // Prefer the client-rendered image so Thai text looks exactly as typed; fall back to drawing text.
                if (!string.IsNullOrEmpty(f.RenderedImage) && DrawImageContain(gfx, f.RenderedImage, r, alignLeft: true)) break;
                var size = Math.Max(6, r.Height * 0.62);
                var font = new XFont(_font, size, XFontStyleEx.Regular, Unicode);
                gfx.DrawString(f.Value ?? "", font, XBrushes.Black, new XRect(r.X + 2, r.Y, r.Width, r.Height), XStringFormats.CenterLeft);
                break;
        }
    }

    static bool DrawImageContain(XGraphics gfx, string? dataUrl, XRect r, bool alignLeft = false)
    {
        var bytes = DataUrl.Decode(dataUrl);
        if (bytes is null) return false;
        using var ims = new MemoryStream(bytes);
        var img = XImage.FromStream(ims);
        var k = Math.Min(r.Width / img.PointWidth, r.Height / img.PointHeight);
        double w = img.PointWidth * k, h = img.PointHeight * k;
        gfx.DrawImage(img, alignLeft ? r.X : r.X + (r.Width - w) / 2, r.Y + (r.Height - h) / 2, w, h);
        return true;
    }

    void AddCertificate(PdfDocument doc, Envelope e)
    {
        var page = doc.AddPage(); page.Size = PdfSharp.PageSize.A4;
        var gfx = XGraphics.FromPdfPage(page);
        double W = page.Width.Point, margin = 40, y = 34;
        var navy = XColor.FromArgb(11, 32, 56); var gray = XColor.FromArgb(100, 116, 139); var blue = XColor.FromArgb(35, 104, 196); var green = XColor.FromArgb(120, 184, 62);
        XFont F(double s, bool b = false) => new(_font, s, b ? XFontStyleEx.Bold : XFontStyleEx.Regular, Unicode);

        var logo = Logo();
        if (logo is not null) gfx.DrawImage(logo, margin, 24, 70, 70 * logo.PointHeight / logo.PointWidth);
        gfx.DrawString("MGT Sign", F(16, true), new XSolidBrush(navy), margin + 82, 50);
        gfx.DrawString("Certificate of Completion", F(11), new XSolidBrush(gray), new XRect(0, 40, W - margin, 14), XStringFormats.TopRight);
        gfx.DrawRectangle(new XSolidBrush(blue), 0, 70, W, 2.5); gfx.DrawRectangle(new XSolidBrush(green), 0, 70, 150, 2.5);
        y = 96;

        void Heading(string t) { gfx.DrawString(t, F(14, true), new XSolidBrush(navy), margin, y + 12); y += 24; }
        void Row(string k, string v, bool bold = false)
        {
            gfx.DrawString(k, F(9), new XSolidBrush(gray), margin, y + 9);
            foreach (var line in Wrap(gfx, v.Replace("→", "->"), F(9, bold), W - margin * 2 - 140)) { gfx.DrawString(line, F(9, bold), new XSolidBrush(navy), margin + 140, y + 9); y += 13; }
            y += 2;
        }
        string D(DateTime? t) => t is null ? "—" : t.Value.ToLocalTime().ToString("MM/dd/yyyy hh:mm:ss tt", En) ;

        Heading("Envelope summary");
        Row("Envelope ID", e.Code, true); Row("Subject", e.Subject); Row("Document", $"{e.Original?.FileName} ({e.Original?.PageCount} pages)");
        Row("Status", e.Status.ToString(), true); Row("Sender", $"{e.SenderName} <{e.SenderEmail}>");
        Row("Created", D(e.CreatedAt)); Row("Completed", D(e.CompletedAt)); Row("Document SHA-256", e.Original?.Sha256 ?? "");
        y += 6;
        if (e.Workflow is { } w)
        {
            Heading($"Approval workflow · {w.Type} · {w.Status}");
            foreach (var s in w.Steps.OrderBy(s => s.Sequence))
            {
                Row($"Step {s.Sequence + 1}: {s.Name}", $"{s.Status} · {WorkflowEngine.RuleText(s)}");
                foreach (var a in s.Approvers) Row("", $"{a.Name} <{a.Email}> · {a.Status}{(a.ActedAt is null ? "" : " · " + D(a.ActedAt))}{(a.Veto ? " · veto" : "")}{(a.IsBackup ? " · backup" : "")}");
            }
            y += 6;
        }
        Heading("Recipients");
        foreach (var r in e.Recipients.OrderBy(r => r.RoutingOrder)) Row($"{r.RoutingOrder}. {r.Role}", $"{r.Name} <{r.Email}> · {r.Status}{(r.CompletedAt is null ? "" : " · " + D(r.CompletedAt))}");
        if (e.Attachments.Count > 0)
        {
            y += 6; Heading($"Attachments ({e.Attachments.Count})");
            foreach (var a in e.Attachments.Take(10)) Row(a.Role.ToString(), $"{a.FileName} · {a.AddedByName} · {D(a.CreatedAt)} · SHA-256 {a.Sha256[..Math.Min(32, a.Sha256.Length)]}…");
        }
        y += 6; Heading("Audit trail");
        foreach (var ev in e.AuditEvents.OrderBy(a => a.At))
        {
            if (y > page.Height.Point - 60) { gfx.DrawString("… see MGT Sign for the full audit trail", F(9), new XSolidBrush(gray), margin, y + 9); break; }
            Row(D(ev.At), $"{ev.Action} — {ev.Actor}{(string.IsNullOrEmpty(ev.Detail) ? "" : ": " + Trim(ev.Detail, 160))}{(string.IsNullOrEmpty(ev.IpAddress) ? "" : " · IP " + ev.IpAddress)}");
        }
        gfx.DrawString($"Generated by MGT Sign · {DateTime.Now.ToString("MM/dd/yyyy hh:mm tt", En)}", F(8), new XSolidBrush(gray), margin, page.Height.Point - 24);
        gfx.Dispose();
    }

    // Unicode (Identity-H) encoding so Thai and other non-Latin text is embedded correctly.
    static readonly XPdfFontOptions Unicode = new(PdfFontEncoding.Unicode);

    static string Trim(string s, int n) => s.Length > n ? s[..(n - 1)] + "…" : s;

    static IEnumerable<string> Wrap(XGraphics g, string text, XFont font, double max)
    {
        var line = "";
        foreach (var ch in text ?? "")
        {
            if (g.MeasureString(line + ch, font).Width > max && line.Length > 0) { yield return line; line = ""; }
            line += ch;
        }
        yield return line;
    }

    static XImage? Logo()
    {
        var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MgtSign.Infrastructure.Resources.mgt-logo.png");
        return s is null ? null : XImage.FromStream(s);
    }
}

public sealed class PdfFontOptions
{
    /// <summary>A TrueType font with Thai glyphs. Defaults to Leelawadee UI / Tahoma on Windows.</summary>
    public string? FontPath { get; set; }
    public string? BoldFontPath { get; set; }
}

/// <summary>PDFsharp needs an explicit font resolver; we load one Thai-capable TTF.</summary>
static class PdfFonts
{
    public const string Family = "MgtSans";
    static readonly object Gate = new();
    static bool _done;

    public static void EnsureRegistered(PdfFontOptions o)
    {
        lock (Gate)
        {
            if (_done) return;
            var regular = First(o.FontPath, @"C:\Windows\Fonts\LeelawUI.ttf", @"C:\Windows\Fonts\tahoma.ttf", "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf")
                ?? throw new InvalidOperationException("No Thai-capable TTF font found. Set Pdf:FontPath in configuration.");
            var bold = First(o.BoldFontPath, @"C:\Windows\Fonts\LeelaUIb.ttf", @"C:\Windows\Fonts\tahomabd.ttf") ?? regular;
            GlobalFontSettings.FontResolver = new Resolver(File.ReadAllBytes(regular), File.ReadAllBytes(bold));
            _done = true;
        }
    }

    static string? First(params string?[] paths) => paths.FirstOrDefault(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p));

    sealed class Resolver(byte[] regular, byte[] bold) : IFontResolver
    {
        public FontResolverInfo? ResolveTypeface(string familyName, bool isBold, bool isItalic) => new(isBold ? "mgt-bold" : "mgt-regular");
        public byte[]? GetFont(string faceName) => faceName == "mgt-bold" ? bold : regular;
    }
}

public static class DataUrl
{
    public static byte[]? Decode(string? dataUrl)
    {
        if (string.IsNullOrEmpty(dataUrl)) return null;
        var i = dataUrl.IndexOf("base64,", StringComparison.Ordinal);
        if (i < 0) return null;
        try { return Convert.FromBase64String(dataUrl[(i + 7)..]); } catch (FormatException) { return null; }
    }
}
