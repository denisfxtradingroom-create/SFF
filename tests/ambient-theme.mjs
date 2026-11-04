import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Static safeguard: ambient visual skin must not redefine the layout model,
// disable pointer events on controls, or replace the existing auth/login UI.
const read = (name) => readFileSync(new URL("../client/" + name, import.meta.url), "utf8");
const page = read("index.html");
const theme = read("ambient-theme.css");
const social = read("social-notifications.js");
assert(page.includes('<link rel="stylesheet" href="/ambient-theme.css" />'));
assert(page.indexOf("/social-wall.css") < page.indexOf("/ambient-theme.css"));
assert(theme.includes(".shell .chat::after"));
assert(theme.includes('content: "SFF"'));
assert(theme.includes("#sffWallScreen::after"));
assert(theme.includes(".shell .members .person"));
assert(theme.includes("@media (max-width: 760px)"));
assert(theme.includes("pointer-events: none"));
assert(!theme.includes(".gate {"));
assert(!theme.includes(".shell {\n  display:"));
assert(!theme.includes("url(http"));
assert(social.includes("mobile.prepend(button);"));
assert(social.includes('button.dataset.sffHome = "1"'));
assert(!social.includes("mobile.appendChild(button)"));
// Catch obvious truncated stylesheet and mismatched CSS blocks.
let braces = 0;
for(const character of theme){
  if(character==="{") braces++;
  else if(character==="}") braces--;
  assert(braces>=0,"Unexpected CSS closing brace");
}
assert.equal(braces,0,"Unclosed CSS rule");
console.log("SFF ambient GUI skin: loaded, responsive, balanced, navigation intact.");
