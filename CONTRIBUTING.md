# Contributing to Lograke

First off, thanks for taking the time to contribute!

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs
- Search existing issues before filing a new one
- Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- Include: environment details, steps to reproduce, expected vs actual behavior, screenshots if applicable

### Suggesting Enhancements
- Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- Explain the use case, expected behavior, and any alternatives considered

### Pull Requests
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following the style guide below
4. Write or update tests for your changes
5. Run tests locally: `npm test`
6. Commit with a descriptive message (see commit conventions below)
7. Push to your branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request using the [PR template](.github/PULL_REQUEST_TEMPLATE.md)

## Development Setup

1. Fork and clone the repo
2. Install dependencies: `npm run install:all`
3. Copy the env template: `cp .env.example backend/.env` (the backend loads `.env` from its own directory) and adjust as needed
4. Run the app: `npm run dev` (starts both backend on port 5000 and frontend on port 5173)
5. Open http://localhost:5173

## Running Tests

```bash
# Run all tests
npm test

# Backend only
npm run test:backend

# Frontend only
npm run test:frontend
```

## Commit Conventions

Use conventional commit messages:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code change without feature/fix
- `docs:` — documentation only
- `chore:` — tooling, dependencies, CI
- `security:` — security-related fixes

## Style Guide
- Follow the existing code style in the file you are editing
- Use meaningful variable and function names
- Avoid empty catch blocks; log or handle errors appropriately
- Keep components under 300 lines; extract sub-components or custom hooks for larger logic
- Prefer `const` over `let` where possible
- Run `npm run lint` (frontend) before committing

## Code Review Process
- All PRs require at least one review before merging
- Reviewers will check for correctness, test coverage, style compliance, and security
- Address review feedback with additional commits (no force-push to shared branches)
