import { parsePassageReferences } from "../../parser.ts";
import type { ParseError, RangeMarker } from "../../parser.ts";

export type ReferenceLocation = {
  docPath: string;
  line: number;
};

/** Maps a reference key to every doc page that uses it. */
export type ReferenceMap = Map<string, ReferenceLocation[]>;

export type PassageLocationInfo = {
  docPath: string;
  anchorId: string;
  url: string;
};

/** Maps a reference key to its unique page location. */
export type PassageLocationMap = Map<string, PassageLocationInfo>;

function stringifyRangeMarker(marker: RangeMarker): string {
  switch (marker.type) {
    case "START":
      return "START";
    case "END":
      return "END";
    case "start":
      return `start(#${marker.passageName})`;
    case "end":
      return `end(#${marker.passageName})`;
  }
}

export function referenceKey(
  filePath: string,
  passageName: string | undefined,
  rangeStart?: RangeMarker,
  rangeEnd?: RangeMarker,
): string {
  if (rangeStart && rangeEnd) {
    return `${filePath}@${stringifyRangeMarker(rangeStart)}..${stringifyRangeMarker(rangeEnd)}`;
  }
  return passageName !== undefined ? `${filePath}:${passageName}` : `${filePath}:`;
}

export function passageAnchorId(refKey: string): string {
  return (
    "spool-" +
    refKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "")
  );
}

export function docPathToUrl(docPath: string): string {
  const withoutExt = docPath.replace(/\.mdx?$/, "");
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, "$1");
  const trimmed = withoutIndex.replace(/\/$/, "");
  return "/" + trimmed;
}

/**
 * Scans all doc files for passage references and builds a map of
 * reference key -> list of doc pages that use it.
 */
export function buildReferenceMap(docContents: Map<string, string>): ReferenceMap {
  const map: ReferenceMap = new Map();

  for (const [docPath, content] of docContents) {
    const { refs } = parsePassageReferences(content);
    for (const ref of refs) {
      const key = referenceKey(ref.filePath, ref.passageName, ref.rangeStart, ref.rangeEnd);
      let locations = map.get(key);
      if (!locations) {
        locations = [];
        map.set(key, locations);
      }
      locations.push({ docPath, line: ref.line });
    }
  }

  return map;
}

/**
 * Returns errors for any reference key that appears on more than one page.
 */
export function verifyUniqueReferences(refMap: ReferenceMap): ParseError[] {
  const errors: ParseError[] = [];

  for (const [key, locations] of refMap) {
    const pages = new Set(locations.map((loc) => loc.docPath));
    if (pages.size > 1) {
      const pageList = [...pages].sort();
      for (const loc of locations) {
        errors.push({
          line: loc.line,
          column: 1,
          message: `Reference "${key}" is used on multiple pages: ${pageList.join(", ")}`,
        });
      }
    }
  }

  return errors;
}

/**
 * Builds a map of reference key -> page URL + anchor for references that
 * appear exactly once.
 */
export function buildPassageLocationMap(refMap: ReferenceMap): PassageLocationMap {
  const map: PassageLocationMap = new Map();

  for (const [key, locations] of refMap) {
    const pages = new Set(locations.map((loc) => loc.docPath));
    if (pages.size === 1) {
      const docPath = locations[0]!.docPath;
      map.set(key, {
        docPath,
        anchorId: passageAnchorId(key),
        url: docPathToUrl(docPath) + "#" + passageAnchorId(key),
      });
    }
  }

  return map;
}
