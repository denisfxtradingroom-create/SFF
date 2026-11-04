import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const social=readFileSync(new URL("../client/social-notifications.js",import.meta.url),"utf8");
assert(social.includes('document.querySelectorAll("[data-social-center]")'));
assert(!social.includes('document.querySelectorAll("[data-sff-home]")'));
assert(social.includes("sff.social.history.v2."));
console.log("SFF: notification badges are attached to the bell, not Početna.");
