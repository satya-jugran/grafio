# Contributing to Grafio

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/satya-jugran/grafio.git
cd grafio

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Project Structure

```
src/
├── Graph.ts              # Main Graph class
├── Node.ts              # Node class
├── Edge.ts              # Edge class
├── cypher/              # Cypher query engine
├── storage/              # Storage providers
└── storage/cache/      # Cache implementations
```

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx jest tests/graph/Graph.node.test.ts
```

## Code Style

- Use TypeScript strict mode
- Follow the existing code style
- Add tests for new features
- Update documentation

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and ensure they pass
5. Submit a pull request