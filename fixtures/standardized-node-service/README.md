# Standardized Node Service

## Prerequisites

- Node.js 20+

## Setup

1. Run `npm install`
2. Copy `.env.example` to `.env`

## Run

Use `npm run dev` for local development.

## Validate

- `npm run validate`
- `npm run coverage`
- `npm run audit`

## Environment variables

- `API_KEY`: token used by the downstream integration
- `PORT`: local port for the HTTP server

## Debugging

The service exposes `/health` for smoke checks.
