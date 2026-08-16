#!/usr/bin/env bash

# Compare the package npm would actually publish with an existing npm release.
# Packages without pack lifecycle hooks keep the cheaper source-file fast path.

package_has_pack_lifecycle() {
  local pkg_json="$1"
  node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const scripts = pkg.scripts || {};
process.exit(["prepare", "prepack", "postpack"].some(name => typeof scripts[name] === "string" && scripts[name].trim()) ? 0 : 1);
' "$pkg_json" >/dev/null 2>&1
}

package_has_publishable_changes() {
  local pkg_dir="$1"
  local pkg_name="$2"
  local npm_version="$3"

  if ! command -v npm >/dev/null 2>&1; then
    echo "unknown"
    return 0
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"

  local remote_tarball
  if ! remote_tarball="$(cd "$tmpdir" && npm pack "${pkg_name}@${npm_version}" --silent 2>/dev/null | tail -n 1)"; then
    rm -rf "$tmpdir"
    echo "unknown"
    return 0
  fi

  local remote_root="$tmpdir/remote/package"
  mkdir -p "$tmpdir/remote"
  if ! tar -xzf "$tmpdir/$(basename "$remote_tarball")" -C "$tmpdir/remote" >/dev/null 2>&1; then
    rm -rf "$tmpdir"
    echo "unknown"
    return 0
  fi

  local local_root="$pkg_dir"
  local local_files=()

  if package_has_pack_lifecycle "$pkg_dir/package.json"; then
    local local_tarball
    mkdir -p "$tmpdir/local-tarballs" "$tmpdir/local"
    if ! local_tarball="$(cd "$pkg_dir" && npm pack --silent --pack-destination "$tmpdir/local-tarballs" 2>/dev/null | tail -n 1)"; then
      rm -rf "$tmpdir"
      echo "unknown"
      return 0
    fi
    if ! tar -xzf "$tmpdir/local-tarballs/$(basename "$local_tarball")" -C "$tmpdir/local" >/dev/null 2>&1; then
      rm -rf "$tmpdir"
      echo "unknown"
      return 0
    fi
    local_root="$tmpdir/local/package"
    mapfile -t local_files < <(cd "$local_root" && find . -type f -printf '%P\n' | sort)
  else
    mapfile -t local_files < <(
      cd "$pkg_dir" && npm pack --dry-run --json --ignore-scripts 2>/dev/null | node -e '
const chunks = [];
process.stdin.on("data", c => chunks.push(c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const report = Array.isArray(data)
      ? data[0]
      : Array.isArray(data?.files)
        ? data
        : Object.values(data ?? {}).find(value => Array.isArray(value?.files));
    const files = report?.files ?? [];
    for (const f of files) {
      if (f?.path) console.log(String(f.path));
    }
  } catch {
    process.exit(1);
  }
});
'
    )
  fi

  if [[ ${#local_files[@]} -eq 0 ]]; then
    rm -rf "$tmpdir"
    echo "unknown"
    return 0
  fi

  local remote_files=()
  local local_files_sorted=()
  mapfile -t remote_files < <(cd "$remote_root" && find . -type f -printf '%P\n' | sort)
  mapfile -t local_files_sorted < <(printf '%s\n' "${local_files[@]}" | sort)

  local local_list remote_list
  local_list="$(printf '%s\n' "${local_files_sorted[@]}")"
  remote_list="$(printf '%s\n' "${remote_files[@]}")"

  if [[ "$local_list" != "$remote_list" ]]; then
    rm -rf "$tmpdir"
    echo "yes"
    return 0
  fi

  local file
  for file in "${local_files_sorted[@]}"; do
    local local_path="$local_root/$file"
    local remote_path="$remote_root/$file"

    if [[ ! -f "$local_path" || ! -f "$remote_path" ]]; then
      rm -rf "$tmpdir"
      echo "yes"
      return 0
    fi

    if [[ "$file" == "package.json" ]]; then
      if ! node -e '
const fs = require("fs");
const [a, b] = process.argv.slice(1);
const ja = JSON.parse(fs.readFileSync(a, "utf8"));
const jb = JSON.parse(fs.readFileSync(b, "utf8"));
delete ja.version;
delete jb.version;
process.exit(JSON.stringify(ja) === JSON.stringify(jb) ? 0 : 1);
' "$local_path" "$remote_path" >/dev/null 2>&1; then
        rm -rf "$tmpdir"
        echo "yes"
        return 0
      fi
      continue
    fi

    if ! cmp -s "$local_path" "$remote_path"; then
      rm -rf "$tmpdir"
      echo "yes"
      return 0
    fi
  done

  rm -rf "$tmpdir"
  echo "no"
}
