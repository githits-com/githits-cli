# Retry Guidelines

This document describes the retry behavior for HTTP transport layers in the GitHits CLI.

## Overview

The GitHits CLI automatically retries transient network failures with exponential backoff and jitter. This improves reliability when network conditions are imperfect, rate limits are hit, or servers experience temporary issues.

## Which Errors Trigger Retry

The following errors are automatically retried:

| Error Type | Description |
|---|---|
| `FetchTimeoutError` | Request timed out (default 120s) |
| `PkgseerTransportError` | Network failure (DNS, socket, connection reset) |
| HTTP 429 | Rate limited by server |
| HTTP 5xx | Server-side errors (500, 502, 503, etc.) |

The following errors are **NOT** retried:

| Error Type | Reason |
|---|---|
| HTTP 4xx (except 429) | Client errors — retrying won't help |
| `AuthenticationError` | Handled by token refresh, not retry |
| `CodeNavigationValidationError` | Invalid input — retrying won't help |
| `CodeNavigationAccessError` | Permission denied — retrying won't help |

## Retry Strategy

### Exponential Backoff

Each retry attempt increases the delay exponentially:

```
delay = baseDelayMs * 2^attempt
```

For example, with `baseDelayMs=1000`:
- Attempt 1: 1000ms
- Attempt 2: 2000ms
- Attempt 3: 4000ms

### Jitter

To prevent thundering herd problems, jitter is applied to each delay:

```
delay = delay * (0.5 + Math.random() * 0.5)
```

This adds randomness between 50-100% of the calculated delay.

### Maximum Delay

Delays are capped at `maxDelayMs` (default: 30000ms) to prevent excessively long waits.

### Default Configuration

| Parameter | Default | Description |
|---|---|---|
| `maxRetries` | 3 | Maximum number of retry attempts |
| `baseDelayMs` | 1000 | Base delay in milliseconds |
| `maxDelayMs` | 30000 | Maximum delay in milliseconds |
| `jitter` | true | Enable/disable jitter |

## Configuration

### Environment Variables

You can override retry behavior using environment variables:

| Variable | Description | Default |
|---|---|---|
| `GITHITS_RETRY_MAX` | Maximum retry attempts | 3 |
| `GITHITS_RETRY_BASE_DELAY_MS` | Base delay in milliseconds | 1000 |
| `GITHITS_RETRY_MAX_DELAY_MS` | Maximum delay in milliseconds | 30000 |
| `GITHITS_RETRY_JITTER` | Enable jitter ("true"/"false") | true |

Example:
```bash
export GITHITS_RETRY_MAX=5
export GITHITS_RETRY_BASE_DELAY_MS=2000
```

### Service Configuration

Each service accepts retry configuration via constructor options:

```typescript
const service = new CodeNavigationServiceImpl(
  endpointUrl,
  tokenProvider,
  fetchFn,
  runtime,
  {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    jitter: true,
  },
);
```

### Request-Level Configuration

Individual requests can override retry options:

```typescript
await postPkgseerGraphql({
  endpointUrl,
  token,
  query,
  variables,
  retryOptions: {
    maxRetries: 1, // Override for this specific request
  },
});
```

## Idempotency

Retry logic respects idempotency — only requests that produce the same result when retried are eligible for automatic retry.

| Request Type | Idempotent? | Retried? |
|---|---|---|
| GraphQL POST (queries) | Yes | Yes |
| REST GET | Yes | Yes |
| REST POST /search | Yes | Yes |
| REST POST /feedbacks | No | No |

The `submitFeedback()` method in `githits-service.ts` is intentionally **not** retried to avoid duplicate submissions.

## Telemetry

Retry attempts are tracked in telemetry spans when `GITHITS_TELEMETRY=1` is set:

- `retry.attempt` — Current attempt number (0-based)
- `retry.maxAttempts` — Maximum attempts allowed
- `retry.delayMs` — Delay before next retry
- `retry.error` — Error name that triggered retry
- `retry.hasMore` — Whether more retries will follow

## MCP Error Envelope

When a request fails after all retry attempts, the MCP error envelope includes retry metadata:

```json
{
  "error": "Request failed after 3 attempts",
  "code": "NETWORK",
  "retryable": true,
  "retryAttempts": 3,
  "retryAfter": 5000
}
```

- `retryAttempts` — Number of attempts made (0 if no retry)
- `retryAfter` — Suggested delay in milliseconds before retrying (from Retry-After header)

## Troubleshooting

### Disable Retry

Set `GITHITS_RETRY_MAX=0` to disable retry entirely.

### Increase Retry Attempts

Set `GITHITS_RETRY_MAX=5` (or higher) for more aggressive retrying.

### Debug Retry Behavior

Enable debug logging to see retry attempts:

```bash
export GITHITS_DEBUG=code-nav
```

This will log retry attempts and delays to stderr.

### Network Issues

If you're experiencing frequent retries, check:

1. Network connectivity
2. DNS resolution
3. Firewall rules
4. VPN configuration
5. Server status at [status.githits.com](https://status.githits.com)

## For AI Assistants

When handling GitHits tool calls:

1. **Check `retryable` flag** — If `true`, the error may resolve on retry
2. **Check `retryAttempts`** — If high, the issue may be persistent
3. **Check `retryAfter`** — Wait at least this long before retrying
4. **Don't retry `AUTH_REQUIRED`** — Ask user to re-authenticate instead
5. **Don't retry `INVALID_ARGUMENT`** — Fix the input instead
6. **Do retry `NETWORK`/`TIMEOUT`/`RATE_LIMITED`** — These are transient

Example retry logic:
```typescript
if (error.retryable && error.retryAttempts < 3) {
  const delay = error.retryAfter ?? 1000;
  await sleep(delay);
  return retryToolCall();
}
```
