import { projectUnifiedSearchPresentation } from "./unified-search-presentation.js";
import type {
  UnifiedSearchStatusCompletedPresentation,
  UnifiedSearchStatusIncompletePresentation,
} from "./unified-search-response.js";
import {
  renderUnifiedSearchPresentationText,
  type UnifiedSearchTextOptions,
} from "./unified-search-text.js";

type StatusPayload =
  | UnifiedSearchStatusCompletedPresentation
  | UnifiedSearchStatusIncompletePresentation;

export function renderUnifiedSearchStatusText(
  payload: StatusPayload,
  options: UnifiedSearchTextOptions = {},
): string {
  const presentation = projectUnifiedSearchPresentation(payload);
  const result = payload.result;
  return renderUnifiedSearchPresentationText(
    presentation,
    {
      results: result?.results ?? [],
      nextOffset: result?.nextOffset,
    },
    options,
  );
}
