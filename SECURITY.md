# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/attiny412-pulsenode/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname, customer data or personal data in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static PulseNode browser workbench, firmware source, KiCad project files, generated Gerber and drill artifacts, CAD exports, test harnesses and project documentation.

In scope:

- A cross-site scripting or HTML injection path through board data, net data, bill of materials data, bookmarked state, generated output or viewer controls.
- A download or file-path handling flaw that turns a repository artifact link into a script execution or cross-origin navigation vector.
- A validation flaw that makes corrupted firmware, PCB, schematic, Gerber, drill, BOM or CAD data appear verified when it is not.
- A test harness or generated export flaw that executes attacker-controlled code outside the documented test boundary.
- A browser persistence or share-state decoding flaw that corrupts another user's workbench state or executes attacker-controlled code.

Out of scope:

- Physical attacks, modified probes, electromagnetic fault injection or laboratory equipment misuse.
- Fabrication defects introduced by a board house after the repository artifacts leave this project.
- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Vulnerabilities in external KiCad, Arduino, browser or fabrication software that are not caused by this repository.
- The documented fact that the browser workbench is a design and verification aid rather than a certified electrical safety tool.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
