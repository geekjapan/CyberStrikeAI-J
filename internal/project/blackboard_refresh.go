package project

import "strings"

// FactIndexSectionHeading is the readable heading line prefix of the blackboard index (kept within the block for the Agent to read).
const FactIndexSectionHeading = "## Project blackboard index"

// FactIndexSectionStartMarker / EndMarker: HTML comment boundaries for programmatic replacement; no instruction meaning for the model.
const (
	FactIndexSectionStartMarker = "<!-- fact-index-start -->"
	FactIndexSectionEndMarker   = "<!-- fact-index-end -->"
)

// ReplaceFactIndexSection replaces the existing project blackboard index section in content with freshIndex.
// freshIndex must be the complete output of BuildFactIndexBlock. Returns (_, false) if the start or end HTML comment is missing.
func ReplaceFactIndexSection(content, freshIndex string) (string, bool) {
	freshIndex = strings.TrimSpace(freshIndex)
	if freshIndex == "" {
		return content, false
	}
	start, ok := factIndexSectionStart(content)
	if !ok {
		return content, false
	}
	end, ok := factIndexSectionEnd(content, start)
	if !ok || end <= start {
		return content, false
	}
	return content[:start] + freshIndex + content[end:], true
}

// RemoveFactIndexSection removes only a complete host-delimited index after a
// successful build returns no block (e.g. a budget too small for framing).
func RemoveFactIndexSection(content string) (string, bool) {
	start, ok := factIndexSectionStart(content)
	if !ok {
		return content, false
	}
	end, ok := factIndexSectionEnd(content, start)
	if !ok || end <= start {
		return content, false
	}
	return content[:start] + content[end:], true
}

// wrapFactIndexBlock adds the unified start and end HTML comment boundaries around the BuildFactIndexBlock body.
func wrapFactIndexBlock(content string) string {
	content = strings.TrimSpace(content)
	return FactIndexSectionStartMarker + "\n" + content + "\n" + FactIndexSectionEndMarker + "\n"
}

// factIndexSafeText removes host delimiters from fact text. The index block is located by literal start and end markers, so if the content
// contains a same-named comment it would close the block early and push the rest of the index outside the system prompt block.
func factIndexSafeText(s string) string {
	s = strings.ReplaceAll(s, FactIndexSectionStartMarker, "")
	return strings.ReplaceAll(s, FactIndexSectionEndMarker, "")
}

func factIndexSectionStart(content string) (int, bool) {
	idx := strings.Index(content, FactIndexSectionStartMarker)
	if idx < 0 {
		return 0, false
	}
	return idx, true
}

func factIndexSectionEnd(content string, start int) (int, bool) {
	if start < 0 || start >= len(content) {
		return 0, false
	}
	tail := content[start:]
	idx := strings.LastIndex(tail, FactIndexSectionEndMarker)
	if idx < 0 {
		return 0, false
	}
	return start + idx + len(FactIndexSectionEndMarker), true
}
