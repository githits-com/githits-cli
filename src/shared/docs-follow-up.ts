import type {
  PackageDocPage,
  PackageDocPageSummary,
  PackageDocSourceKind,
} from "../services/index.js";

export type DocReadFollowUp = {
  type: "read_doc";
  pageId: string;
};

export type FileReadFollowUp = {
  type: "read_file";
  repoUrl: string;
  gitRef: string;
  path: string;
};

export function lowerDocSourceKind(
  value: PackageDocSourceKind | undefined,
): "crawled" | "repo" | undefined {
  switch (value) {
    case "CRAWLED":
      return "crawled";
    case "REPOSITORY":
      return "repo";
    default:
      return undefined;
  }
}

export function buildDocReadFollowUp(
  pageId: string | undefined,
): DocReadFollowUp | undefined {
  if (!pageId) return undefined;
  return { type: "read_doc", pageId };
}

export function buildFileReadFollowUp(
  entry:
    | Pick<PackageDocPageSummary, "repoUrl" | "gitRef" | "filePath">
    | Pick<PackageDocPage, "repoUrl" | "gitRef" | "filePath">,
): FileReadFollowUp | undefined {
  if (!entry.repoUrl || !entry.gitRef || !entry.filePath) {
    return undefined;
  }

  return {
    type: "read_file",
    repoUrl: entry.repoUrl,
    gitRef: entry.gitRef,
    path: entry.filePath,
  };
}
