package vision

import "testing"

func TestLooksLikeCaptchaQuestion(t *testing.T) {
	cases := []struct {
		name string
		q    string
		want bool
	}{
		{"captcha keyword", "Read the captcha", true},
		{"verification code keyword", "What is the verification code?", true},
		{"output only with character", "Output only the characters you see", true},
		{"only output with character", "Only output the character sequence", true},
		// Chinese below stays: questions may still be written in Chinese.
		{"legacy captcha word", "识别验证码", true},
		{"legacy graphic code word", "识别图形码", true},
		{"legacy only-output with legacy character word", "只输出 图片中的字符", true},
		{"legacy only-output with english character word", "只输出 the character", true},
		{"english only-output with legacy character word", "output only 字符", true},
		{"output only without character", "Output only the page title", false},
		{"character without output only", "Describe the character on the sign", false},
		{"unrelated", "Describe the login page layout", false},
	}
	for _, c := range cases {
		if got := looksLikeCaptchaQuestion(c.q); got != c.want {
			t.Errorf("%s: looksLikeCaptchaQuestion(%q) = %v, want %v", c.name, c.q, got, c.want)
		}
	}
}
