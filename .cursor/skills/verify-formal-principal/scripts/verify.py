#!/usr/bin/env python3
"""Bounded exhaustive checks of real Go source, with scratch-only mutations."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = ROOT / "internal/authctx/principal.go"
MUTATIONS = (
    ("false-grant", "if allowed {", "if true {\n_ = allowed", "GRANT_SNAPSHOT"),
    ("permission-alias", "Permissions: permissionCopy", "Permissions: permissions", "GRANT_SNAPSHOT"),
    ("scope-alias", "PermissionScopes: scopeCopy", "PermissionScopes: permissionScopes", "SCOPE_SNAPSHOT_PRECEDENCE"),
    ("global-scope-first", 'if scope := strings.TrimSpace(p.PermissionScopes[permission]); scope != "" {',
     'if scope := strings.TrimSpace(p.Scope); scope != "" { return scope }; if scope := strings.TrimSpace(p.PermissionScopes[permission]); scope != "" {', "SCOPE_SNAPSHOT_PRECEDENCE"),
)


def run(source, label, expected_failure=None):
    with tempfile.TemporaryDirectory(prefix="verify-principal-") as scratch:
        directory = Path(scratch)
        (directory / "principal.go").write_text(source)
        (directory / "principal_test.go").write_bytes((HERE / "principal_test.go").read_bytes())
        env = dict(os.environ, GO111MODULE="off", GOWORK="off", GOPROXY="off", GOTOOLCHAIN="local")
        result = subprocess.run(
            ["go", "test", "-count=1", "-v", "principal.go", "principal_test.go"],
            cwd=directory, env=env, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, timeout=60,
        )
        print(f"--- {label} ---\n{result.stdout}", end="", flush=True)
        if expected_failure:
            if result.returncode == 0 or expected_failure not in result.stdout or "--- FAIL: TestBoundedPrincipalProtection" not in result.stdout:
                raise SystemExit(f"mutation not detected by expected property: {label}")
        elif result.returncode:
            raise SystemExit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mutation", action="store_true", help="also require all four scratch mutants to fail, then rerun baseline")
    args = parser.parse_args()
    original = SOURCE.read_bytes()
    source = original.decode()
    print(subprocess.check_output(["go", "version"], text=True).strip(), flush=True)
    print(f"source SHA256 {hashlib.sha256(original).hexdigest()}", flush=True)
    run(source, "baseline")
    if args.mutation:
        for name, old, new, failure in MUTATIONS:
            if source.count(old) != 1:
                raise SystemExit(f"mutation anchor drifted: {name}; re-sync verification with source")
            run(source.replace(old, new, 1), name, failure)
        run(source, "restored baseline")
    if SOURCE.read_bytes() != original:
        raise SystemExit("production source changed concurrently; rerun on a stable snapshot")
    print("PASS: bounded actual-code verification" + (" and four detected scratch mutations" if args.mutation else ""))


if __name__ == "__main__":
    main()
