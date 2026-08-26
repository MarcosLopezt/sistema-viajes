import type { PassportAlertLevel } from "@/lib/domain/passport";

/**
 * Fila de pasajero tal como la recibe el cliente: todo primitivo, sin Date ni
 * Decimal. La página serializa una sola vez y los tres paneles comparten esta
 * forma.
 */
export interface PassengerRow {
  id: string;
  fullName: string | null;
  nationality: string | null;
  roomType: "DOBLE" | "SINGLE";
  roomId: string | null;
  roomLabel: string | null;
  status: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  isCoordinator: boolean;
  passportLevel: PassportAlertLevel;
  completionPercentage: number;
  isComplete: boolean;
  needsRoommate: boolean;
}

export interface InvitationRow {
  id: string;
  email: string;
  roomType: "DOBLE" | "SINGLE";
  state: "PENDIENTE" | "USADA" | "VENCIDA" | "REVOCADA";
  expiresAt: string;
  createdAt: string;
}

export interface RoomRow {
  id: string;
  label: string;
  occupants: { id: string; fullName: string | null }[];
}
