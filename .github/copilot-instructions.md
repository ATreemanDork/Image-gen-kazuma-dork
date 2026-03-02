# Project: Image-gen-kazuma-dork

## Overview
Image-gen-kazuma-dork is a project for image generation workflows, likely integrating with ComfyUI or similar tools. It includes a sample HTML interface, JavaScript logic, and references to workflow JSONs.

## Agent Execution Policy
- Agents must never move forward beyond the current plan or task without express user permission.
- Always await explicit approval before taking additional or out-of-scope actions.

## Tech Stack
- Language: JavaScript
- Framework: None (Vanilla JS)
- Package Manager: None

## Code Standards
- Follow Airbnb JavaScript style guide conventions
- Use Prettier for formatting
- Run ESLint before committing (if configured)

## Architecture
- index.js: Main JavaScript logic for the app
- example.html: UI for image generation
- reference/: Stores workflow JSONs (e.g., ExampleComfyWorkflow.json)

## Development Workflow
1. Edit HTML/CSS/JS files as needed
2. Test in browser (open example.html)
3. Update reference workflows as required

## Important Patterns
- Modularize JS logic for maintainability
- Keep workflow JSONs versioned in reference/

## Do Not
- Do not commit large binary files
- Do not hardcode sensitive data

## References
- [SillyTavern Extension Creation & Best Practices](https://docs.sillytavern.app/for-contributors/writing-extensions/)

