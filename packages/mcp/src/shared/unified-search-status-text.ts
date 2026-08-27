import { projectUnifiedSearchPresentation } from "./unified-search-presentation.js";
import type {
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
} from "./unified-search-response.js";
import { renderUnifiedSearchPresentationText } from "./unified-search-text.js";

type StatusPayload =
  | UnifiedSearchStatusCompletedPayload
  | UnifiedSearchStatusIncompletePayload;

export function renderUnifiedSearchStatusText(payload: StatusPayload): string {
  const presentation = projectUnifiedSearchPresentation(payload);
  const result = payload.result;
  return renderUnifiedSearchPresentationText(presentation, {
    results: result?.results ?? [],
    nextOffset: result?.nextOffset,
  });
}
