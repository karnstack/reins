---
"@karnstack/reins": patch
"@reins/extension": patch
---

Step commands see web components and custom controls. `reins snapshot` now lists elements inside open shadow roots (a site's search button, a `Sort by` menu built as a web component) and names them the way `reins do` does — through `aria-labelledby`, labels, shadow roots and slots — and `--ref` reaches them in `click`, `type`, `fill`, `hover`, `select` and the rest. `--selector` stays light-DOM CSS. Each snapshot now re-issues its refs, so a ref no longer lands on an element hidden since the previous snapshot (the "element has zero size" failures on wizards and tab panels). A click on a control with no box of its own — a native radio or checkbox shrunk to 0×0 under a styled card, or a `display: contents` wrapper — presses its visible label, custom radio/switch it sits in, or first rendered child instead.
