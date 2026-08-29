Return only valid JSON matching the provided schema. Do not include markdown,
prose, code fences, or any text outside the JSON object.

Include:

- `status`: `success`, `failure`, or `inconclusive`.
- `answer`: your final answer with the evidence you found as a string.
- `confidence`: `high`, `medium`, or `low`.
