# Local pickup conversation evidence

Unaltered Chromium element screenshots of the real production React build and
Express API, using verified disposable MongoDB fixtures. All names and message
contents are synthetic examples. Captures contain no credentials, email addresses,
bypass URLs, cookies, headers or real member messages. No hosted environment was
used or deployed.

- [Desktop conversation](conversation-desktop.png): 1440px viewport; own/other
  participant roles, chronological messages, manual refresh and multiline input.
- [Narrow mobile conversation](conversation-mobile.png): 320px viewport; wrapped
  content, full-width input, readable labels and usable controls.

Captured by the local-only `e2e/pickup-chat.spec.cjs` scenario with
`M62_CAPTURE_DOCS=1`. Automated CI keeps this capture option off, with screenshots,
traces and video disabled. The scenario also verifies 2-party exchange, preserved
reading position, Unicode input, keyboard sending, manual failure recovery,
read-only closed history and axe WCAG A/AA checks. These checks do not establish
screen-reader, Safari, real-device keyboard or hosted messaging compatibility.
