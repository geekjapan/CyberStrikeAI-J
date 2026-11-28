package project

import "strings"

// VisionImageSectionMarker is the image analysis section heading (consistent with the injection by AppendVisionImageAnalysisIfReady).
const VisionImageSectionMarker = "## Image analysis"

// VisionImageAnalysisSection is the image analysis prompt shared by single and multi agents (analyze_image; context keeps only the text summary).
func VisionImageAnalysisSection() string {
	var b strings.Builder
	b.WriteString(VisionImageSectionMarker)
	b.WriteString("\n\n")
	b.WriteString("- When you encounter image files (screenshots, captchas, login pages, report figures) and the analyze_image tool exists, pass the file path on the server to analyze them.\n")
	b.WriteString("- Do not use read_file on binary images expecting to understand their content; the \"📎 xxx.png: /path\" in the user message is the path you can pass to analyze_image.\n")
	b.WriteString("- Captchas: if one has been saved from the page or API as a local image (e.g. captcha.png), use analyze_image with the question stating \"output only the captcha characters\"; if recognition fails, refresh the captcha, save it again and retry; do not expect complex slider/behavioral captchas to be recognized in a single image pass.\n")
	b.WriteString("- When delegating to a sub-agent, if the subtask involves reading a captcha/screenshot, state the image path and the expected output format in the task description.\n")
	return b.String()
}

// AppendVisionImageAnalysisIfReady appends the image analysis prompt only when vision.enabled is true and a model is configured.
func AppendVisionImageAnalysisIfReady(base string, visionReady bool) string {
	if !visionReady {
		return base
	}
	return AppendSystemPromptBlock(base, VisionImageAnalysisSection())
}
