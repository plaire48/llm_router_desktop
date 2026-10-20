// Pinned public source configuration, not synthetic evaluation fixtures.
import {pathToFileURL} from "node:url";
import path from "node:path";
export const PUBLIC_REPOSITORIES = [
  {
    "repository": "vuejs/core",
    "commit": "ef81ddcfc94399c043b349a986a1b231b6bac7d6",
    "tier": "small",
    "subtrees": [],
    "licenseApi": "MIT",
    "sourceUrl": "https://github.com/vuejs/core/tree/ef81ddcfc94399c043b349a986a1b231b6bac7d6"
  },
  {
    "repository": "nodejs/node",
    "commit": "3e5c8afba6dcff91d46b8204276d62e3843b23b6",
    "tier": "medium",
    "subtrees": [
      "lib",
      "test",
      "doc"
    ],
    "licenseApi": "NOASSERTION",
    "sourceUrl": "https://github.com/nodejs/node/tree/3e5c8afba6dcff91d46b8204276d62e3843b23b6"
  },
  {
    "repository": "llvm/llvm-project",
    "commit": "3c038bc08e08996b94bd3d35f2a95ad0b392a78d",
    "tier": "large",
    "subtrees": [],
    "licenseApi": "NOASSERTION",
    "sourceUrl": "https://github.com/llvm/llvm-project/tree/3c038bc08e08996b94bd3d35f2a95ad0b392a78d"
  }
];
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(PUBLIC_REPOSITORIES));
