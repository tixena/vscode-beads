/**
 * SVG Icon imports
 *
 * Icons from Font Awesome Free (CC BY 4.0)
 * https://fontawesome.com
 */

import boltSvg from "./bolt.svg";
// Issue type icons
import bugSvg from "./bug.svg";
import codeMergeSvg from "./code-merge.svg";
import externalLinkSvg from "./external-link.svg";
import flaskSvg from "./flask.svg";
import lightbulbSvg from "./lightbulb.svg";
import notdefSvg from "./notdef.svg";
import squareCheckSvg from "./square-check.svg";
import tagSvg from "./tag.svg";
// UI icons
import userSvg from "./user.svg";
import wrenchSvg from "./wrench.svg";

export const icons = {
  // Issue types
  bug: bugSvg,
  feature: lightbulbSvg,
  task: squareCheckSvg,
  epic: boltSvg,
  chore: wrenchSvg,
  "merge-request": codeMergeSvg,
  molecule: flaskSvg,
  // UI
  user: userSvg,
  tag: tagSvg,
  "external-link": externalLinkSvg,
  notdef: notdefSvg,
} as const;

export type IconName = keyof typeof icons;
