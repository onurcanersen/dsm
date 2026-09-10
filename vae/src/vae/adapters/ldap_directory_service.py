"""Mock: the LDAP directory service as a fixed set of users (SRS DSM-VAE req 3)."""

from __future__ import annotations

from typing import Optional

from vae.domain.user import Role, User
from vae.ports.directory_service import IDirectoryService


class LdapDirectoryService(IDirectoryService):
    """Mock: accepts admin/admin and operator/operator."""

    _USERS = {"admin": ("admin", Role.ADMIN), "operator": ("operator", Role.OPERATOR)}

    def authenticate(self, username: str, password: str) -> Optional[User]:
        entry = self._USERS.get(username)
        if entry is None or entry[0] != password:
            return None
        return User(username, entry[1])
