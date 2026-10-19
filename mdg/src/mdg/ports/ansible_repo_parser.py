"""Port for the parser of the cloned ansible repo: the enrichment of the
processor units, the networks and the connects between them
(SRS DSM-MDG req 2.4, 3)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Callable, List

from mdg.domain.source_data import ConnectsTo, Network, Node


class IAnsibleRepoParser(ABC):
    """Answers the network topology questions for one cloned ansible repo.
    Implementations are constructed as (ansible_repo_dir, project_name, platform_name)
    after the ansible repo has been cloned."""

    @abstractmethod
    def get_nodes(self) -> List[Node]:
        """The enrichment of each processor unit by name (req 3)."""

    @abstractmethod
    def get_networks(self) -> List[Network]:
        """The networks with their purpose (req 3)."""

    @abstractmethod
    def get_connects_to(self) -> List[ConnectsTo]:
        """The connections between nodes and networks (req 3)."""


AnsibleRepoParserFactory = Callable[[Path, str, str], IAnsibleRepoParser]
