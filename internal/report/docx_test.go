package report

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"testing"
	"time"

	"cyberstrike-ai/internal/database"
)

func TestWordReportEscapesEvidenceAndHonorsSections(t *testing.T) {
	template := DefaultTemplate()
	template.Title = "Client Report & <Customer>"
	template.IncludeRemediation = false
	v := &database.Vulnerability{Title: "Pending finding", Severity: "high", Status: "false_positive", Evidence: "<script>&\x00\nGET /?x=1&y=2", Recommendation: "must-be-omitted"}
	data, err := Render(template, Snapshot{Summary: "Original reply", GeneratedAt: time.Now(), Findings: []*database.Vulnerability{v}})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	parts := map[string]string{}
	for _, f := range z.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		decoder := xml.NewDecoder(bytes.NewReader(b))
		for {
			_, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("invalid XML in %s: %v", f.Name, err)
			}
		}
		parts[f.Name] = string(b)
	}
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"} {
		if parts[name] == "" {
			t.Fatalf("missing part %s", name)
		}
	}
	doc := parts["word/document.xml"]
	for _, text := range []string{"Client Report &amp; &lt;Customer&gt;", "&lt;script&gt;&amp;", "false_positive", "Original reply"} {
		if !strings.Contains(doc, text) {
			t.Errorf("missing %q", text)
		}
	}
	if strings.Contains(doc, "must-be-omitted") || strings.ContainsRune(doc, 0) {
		t.Fatal("excluded content or invalid control character retained")
	}
	template.IncludeEvidence = false
	data, err = Render(template, Snapshot{Findings: []*database.Vulnerability{v}})
	if err != nil {
		t.Fatal(err)
	}
	z, _ = zip.NewReader(bytes.NewReader(data), int64(len(data)))
	for _, f := range z.File {
		if f.Name == "word/document.xml" {
			r, _ := f.Open()
			b, _ := io.ReadAll(r)
			r.Close()
			if bytes.Contains(b, []byte("&lt;script&gt;")) {
				t.Fatal("evidence not excluded")
			}
		}
	}
}

// Non-ASCII text must survive into word/document.xml unescaped and as valid XML.
func TestWordReportKeepsNonASCIITitleAndFinding(t *testing.T) {
	template := DefaultTemplate()
	// Japanese stays: multi-byte text must be written to the document as is.
	template.Title = "脆弱性レポート"
	v := &database.Vulnerability{Title: "SQLインジェクション", Severity: "high", Status: "open"}
	data, err := Render(template, Snapshot{GeneratedAt: time.Now(), Findings: []*database.Vulnerability{v}})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var doc []byte
	for _, f := range z.File {
		if f.Name != "word/document.xml" {
			continue
		}
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		doc, err = io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := xml.Unmarshal(doc, new(struct{})); err != nil {
		t.Fatalf("document.xml is not valid XML: %v", err)
	}
	for _, text := range []string{"脆弱性レポート", "SQLインジェクション"} { // Japanese stays: multi-byte handling
		if !bytes.Contains(doc, []byte(text)) {
			t.Errorf("document.xml lost %q", text)
		}
	}
}

func TestWordReportRejectsOversizedInput(t *testing.T) {
	if _, err := Render(DefaultTemplate(), Snapshot{Summary: strings.Repeat("x", 8*1024*1024+1)}); err == nil {
		t.Fatal("oversized report accepted")
	}
	template := DefaultTemplate()
	template.Title = ""
	if _, err := Render(template, Snapshot{}); err == nil {
		t.Fatal("empty title accepted")
	}
}
