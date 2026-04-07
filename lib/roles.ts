export type Role = "user" | "mod" | "admin" | "owner";

export type UserProfile = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
};

export function isFeatureManager(role: Role | null) {
  return role === "admin" || role === "owner";
}

export function isCommentModerator(role: Role | null) {
  return role === "mod" || role === "admin" || role === "owner";
}

export function canManageRoles(role: Role | null) {
  return role === "admin" || role === "owner";
}

export function canAssignRole(currentRole: Role | null, nextRole: Role) {
  if (currentRole === "owner") {
    return nextRole !== "owner";
  }

  if (currentRole === "admin") {
    return nextRole === "user" || nextRole === "mod";
  }

  return false;
}

export function roleLabel(role: Role | null) {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "mod":
      return "Mod";
    case "user":
      return "Usuario";
    default:
      return "Visitante";
  }
}
