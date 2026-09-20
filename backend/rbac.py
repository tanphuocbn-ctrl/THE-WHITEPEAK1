"""Role-Based Access Control. Permission checks are enforced server-side at every layer."""
from fastapi import HTTPException

# System roles (global)
ROLE_SUPER_ADMIN = "super_admin"
ROLE_SECRETARY = "secretary"
ROLE_SKILL_MANAGER = "skill_manager"
ROLE_MEMBER = "member"  # default system role

# Project-scoped roles (stored per project member)
PROJECT_ROLES = ["pm", "team_lead", "member", "reviewer", "editor", "guest"]
SYSTEM_ROLES = [ROLE_SUPER_ADMIN, ROLE_SECRETARY, ROLE_SKILL_MANAGER, ROLE_MEMBER]

# Capability matrix per PROJECT role. super_admin bypasses everything.
# secretary has studio-wide read + project create.
PROJECT_CAPS = {
    "pm": {
        "project.view", "project.edit", "project.delete", "project.manage_members",
        "structure.view", "structure.write",
        "assignment.view", "assignment.write",
        "version.view", "version.upload",
        "review.view", "review.decide", "review.return",
        "script.view", "script.write",
        "audit.view", "audit.restore",
    },
    "team_lead": {
        "project.view", "structure.view", "structure.write",
        "assignment.view", "assignment.write",
        "version.view", "version.upload",
        "review.view", "script.view", "script.write", "audit.view",
    },
    "member": {
        "project.view", "structure.view",
        "assignment.view", "version.view", "version.upload",
        "review.view", "script.view",
    },
    "editor": {
        "project.view", "structure.view",
        "assignment.view", "version.view", "version.upload",
        "review.view", "script.view",
    },
    "reviewer": {
        "project.view", "structure.view", "assignment.view",
        "version.view", "review.view", "review.decide", "review.return",
        "script.view",
    },
    "guest": {"project.view", "structure.view", "version.view", "review.view", "script.view"},
}


def is_super(user: dict) -> bool:
    return user.get("role") == ROLE_SUPER_ADMIN


def can_create_project(user: dict) -> bool:
    return user.get("role") in (ROLE_SUPER_ADMIN, ROLE_SECRETARY)


def project_role_of(user: dict, project: dict) -> str | None:
    if is_super(user):
        return "pm"  # effective full access
    uid = user["id"]
    for m in project.get("members", []):
        if m["user_id"] == uid:
            return m["role"]
    # secretary gets studio-wide read
    if user.get("role") == ROLE_SECRETARY:
        return "guest"
    return None


def has_cap(user: dict, project: dict, cap: str) -> bool:
    if is_super(user):
        return True
    role = project_role_of(user, project)
    if role is None:
        return False
    # secretary studio-wide: read caps only (guest set) unless explicit member
    return cap in PROJECT_CAPS.get(role, set())


def require_cap(user: dict, project: dict, cap: str):
    if not has_cap(user, project, cap):
        raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện hành động này")
