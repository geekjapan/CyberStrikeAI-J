package openai

import "testing"

func TestNormalizeStreamingDelta_RepeatedCharBoundary(t *testing.T) {
	// Streaming chunks split at a repeated-digit boundary: the first character of "43" must not be wrongly merged with the last character of "194".
	cur, d := normalizeStreamingDelta("https://x:194", "43")
	if want := "https://x:19443"; cur != want {
		t.Fatalf("next: want %q got %q", want, cur)
	}
	if d != "43" {
		t.Fatalf("delta: want %q got %q", "43", d)
	}
}

// Chinese stays: multi-byte characters must be compared as whole characters.
func TestNormalizeStreamingDelta_CumulativePrefix(t *testing.T) {
	cur, d := normalizeStreamingDelta("今天", "今天天气")
	if cur != "今天天气" || d != "天气" {
		t.Fatalf("got cur=%q d=%q", cur, d)
	}
}

// Chinese stays: multi-byte characters must be compared as whole characters.
func TestNormalizeStreamingDelta_FullRetransmit(t *testing.T) {
	cur, d := normalizeStreamingDelta("今天", "今天")
	if d != "" || cur != "今天" {
		t.Fatalf("got cur=%q d=%q", cur, d)
	}
}

// Chinese stays: multi-byte characters must be compared as whole characters.
func TestNormalizeStreamingDelta_SingleRuneRepeated(t *testing.T) {
	cur, d := normalizeStreamingDelta("呀", "呀")
	if want := "呀呀"; cur != want {
		t.Fatalf("next: want %q got %q", want, cur)
	}
	if d != "呀" {
		t.Fatalf("delta: want %q got %q", "呀", d)
	}
	cur, d = normalizeStreamingDelta("4", "4")
	if want := "44"; cur != want {
		t.Fatalf("next: want %q got %q", want, cur)
	}
	if d != "4" {
		t.Fatalf("delta: want %q got %q", "4", d)
	}
}

func TestNormalizeStreamingDelta_CumulativeExtendsNumber(t *testing.T) {
	// After "194" is buffered, the cumulative string "19443" arrives (note "1943" is not a prefix of "19443", so HasPrefix cannot be tested with a mis-typed intermediate state).
	cur, d := normalizeStreamingDelta("194", "19443")
	if want := "19443"; cur != want {
		t.Fatalf("next: want %q got %q", want, cur)
	}
	if d != "43" {
		t.Fatalf("delta: want %q got %q", "43", d)
	}
}
