#!/bin/sh
#
# Container command for the mock Gitea: starts Gitea, then seeds two orgs with
# one repo per fixture dir under ./seed (named <unit>_<version>), each pushed
# as a single commit on main plus a tag for the version. The units listed in
# MIRROR_UNITS are seeded only under MIRROR_ORG, so a production has to reach
# the fallback_connection_address of dve.ini to clone them.

set -eu

GITEA_URL="http://gitea:3000"
GITEA_USER="dsm"
GITEA_PASSWORD="dsm"
GITEA_EMAIL="dsm@standin.local"
ORG="dsm-src"
MIRROR_ORG="dsm-mirror"
MIRROR_UNITS="sensor_app"
SEED_ROOT="/opt/dsm/seed"

log() { echo "[dsm-git-seed] $*"; }
api() { curl -sf -o /dev/null -u "$GITEA_USER:$GITEA_PASSWORD" -H 'content-type: application/json' -d "$2" "$GITEA_URL/api/v1/$1"; }

log "starting Gitea"
s6-svscan /etc/s6 &
until curl -sf "$GITEA_URL/api/healthz" >/dev/null; do sleep 2; done

log "admin user '$GITEA_USER'"
su-exec git gitea admin user create --admin --username "$GITEA_USER" --password "$GITEA_PASSWORD" --email "$GITEA_EMAIL" \
    || log "  already present"

log "organization '$ORG'"
api orgs "{\"username\":\"$ORG\"}" || log "  already present"

log "organization '$MIRROR_ORG'"
api orgs "{\"username\":\"$MIRROR_ORG\"}" || log "  already present"

git config --global user.name "dsm seed"
git config --global user.email "$GITEA_EMAIL"

for dir in "$SEED_ROOT"/*/; do
    dir=${dir%/}
    name=$(basename "$dir")
    unit=${name%_*}
    version=${name##*_}

    case " $MIRROR_UNITS " in
        *" $unit "*) target_org=$MIRROR_ORG ;;
        *) target_org=$ORG ;;
    esac

    log "repository '$target_org/$unit' at $version"
    api "orgs/$target_org/repos" "{\"name\":\"$unit\",\"private\":true}" || log "  already present"

    work=$(mktemp -d)
    cp -R "$dir/." "$work"
    git -C "$work" init -q -b main
    git -C "$work" add -A
    git -C "$work" commit -q -m "$unit $version"
    git -C "$work" tag "$version"
    git -C "$work" push -q --force "http://$GITEA_USER:$GITEA_PASSWORD@${GITEA_URL#http://}/$target_org/$unit.git" main "$version"
    rm -rf "$work"
done

log "done"
wait
