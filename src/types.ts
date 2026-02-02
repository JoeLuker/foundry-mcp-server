import { z } from "zod";

export interface FoundryConfig {
  url: string;
  userId: string;
  password: string;
}

export interface WorldInfo {
  active: boolean;
  version: string;
  world?: string;
  system?: string;
  systemVersion?: string;
  users?: number;
  uptime?: number;
}

export interface DocumentSocketRequest {
  type: string;
  action: "get" | "create" | "update" | "delete";
  operation: Record<string, unknown>;
}

export interface DocumentSocketResponse {
  type: string;
  action: string;
  broadcast: boolean;
  operation: Record<string, unknown>;
  userId: string;
  result?: Record<string, unknown>[] | string[];
  error?: { message: string; stack?: string };
}

export type ConnectionState =
  | "disconnected"
  | "authenticating"
  | "connecting"
  | "connected"
  | "ready";

export const DOCUMENT_TYPES = [
  "Actor",
  "Adventure",
  "Cards",
  "ChatMessage",
  "Combat",
  "FogExploration",
  "Folder",
  "Item",
  "JournalEntry",
  "Macro",
  "Playlist",
  "RollTable",
  "Scene",
  "Setting",
  "User",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export const EMBEDDED_DOCUMENT_TYPES = [
  "ActiveEffect",
  "ActorDelta",
  "AmbientLight",
  "AmbientSound",
  "Card",
  "Combatant",
  "CombatantGroup",
  "Drawing",
  "Item",
  "JournalEntryPage",
  "MeasuredTemplate",
  "Note",
  "PlaylistSound",
  "Region",
  "RegionBehavior",
  "TableResult",
  "Tile",
  "Token",
  "Wall",
] as const;

export type EmbeddedDocumentType = (typeof EMBEDDED_DOCUMENT_TYPES)[number];
export const embeddedDocumentTypeSchema = z.enum(EMBEDDED_DOCUMENT_TYPES);
