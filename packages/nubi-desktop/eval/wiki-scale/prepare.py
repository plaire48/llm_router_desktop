"""Download pinned public source archives, never execute their code.
Usage: python3 prepare.py OUTPUT_DIRECTORY
Only regular files within selected subtrees (and root license files) are copied.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import time

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
repositories = json.loads(subprocess.check_output(
    ["node", str(Path(__file__).with_name("sources.mjs"))], text=True))
for repo in repositories:
    name = repo["repository"].replace("/", "-")
    target = out / name
    target.mkdir()  # Never reuse a modified checkout as a pinned baseline.
    archive = out / (name + ".tar.gz")
    url = f'https://codeload.github.com/{repo["repository"]}/tar.gz/{repo["commit"]}'
    subprocess.run(["curl", "--fail", "--location", "--max-time", "600",
                    "--max-filesize", "1073741824", "--output", str(archive), url], check=True)
    archive_hash = hashlib.sha256()
    with archive.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            archive_hash.update(block)
    files, size, omitted_links, licenses = 0, 0, 0, []
    tree_hash = hashlib.sha256()
    started = time.monotonic()
    with tarfile.open(archive, "r|gz") as source:
        for entry in source:
            parts = PurePosixPath(entry.name).parts
            if not parts or parts[0].startswith("/") or ".." in parts:
                raise ValueError("unsafe archive path")
            rel = PurePosixPath(*parts[1:])
            if not rel.parts:
                continue
            if not entry.isfile():
                omitted_links += int(entry.issym() or entry.islnk())
                continue
            license_file = len(rel.parts) == 1 and rel.name.lower().startswith(("license", "copying", "notice"))
            if repo["subtrees"] and rel.parts[0] not in repo["subtrees"] and not license_file:
                continue
            size += entry.size
            if size > 8 * 1024**3:
                raise ValueError("source expansion exceeds 8 GiB")
            dest = target / str(rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with source.extractfile(entry) as reader, dest.open("xb") as writer:
                for block in iter(lambda: reader.read(1024 * 1024), b""):
                    digest.update(block)
                    writer.write(block)
            tree_hash.update(f"{rel}\0{digest.hexdigest()}\n".encode())
            files += 1
            if license_file:
                licenses.append({"path": str(rel), "sha256": digest.hexdigest()})
    record = {**repo, "root": str(target), "files": files, "bytes": size,
              "archiveSha256": archive_hash.hexdigest(), "orderedFileDigest": tree_hash.hexdigest(),
              "omittedSymlinksAndHardlinks": omitted_links, "licenses": licenses,
              "extractionSeconds": time.monotonic() - started, "history": "archive_without_git_history"}
    (out / (name + "-source.json")).write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record), flush=True)
