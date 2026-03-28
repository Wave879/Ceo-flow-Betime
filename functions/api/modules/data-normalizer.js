// ✅ Data normalization helpers

function normalizeKnownGroupInGroup(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    return null;
}

function normalizeNonNegativeInteger(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    return Math.floor(parsed);
}

function resolveHistoricalMemberCountFloor(...candidates) {
    let floor = null;

    for (const candidate of candidates) {
        const normalized = normalizeNonNegativeInteger(candidate);
        if (normalized === null) {
            continue;
        }

        if (floor === null || normalized > floor) {
            floor = normalized;
        }
    }

    return floor;
}

function getForcedMinimumMemberCount(env = {}) {
    const candidate =
        env?.FORCED_MIN_MEMBER_COUNT ??
        env?.GROUP_MEMBER_COUNT_MIN ??
        1;

    const normalized = normalizeNonNegativeInteger(candidate);
    if (normalized === null) {
        return 1;
    }

    return normalized;
}

function shouldIncludeBotInMemberCount(env = {}) {
    const normalized = String(env?.LINE_MEMBER_COUNT_INCLUDE_BOT ?? 'true').trim().toLowerCase();
    return !(normalized === 'false' || normalized === '0' || normalized === 'no');
}

function normalizeLineMembersCountForDisplay(rawCount, env = {}) {
    const normalized = normalizeNonNegativeInteger(rawCount);
    if (normalized === null) {
        return null;
    }

    if (shouldIncludeBotInMemberCount(env)) {
        return normalized + 1;
    }

    return normalized;
}

export {
    normalizeKnownGroupInGroup,
    normalizeNonNegativeInteger,
    resolveHistoricalMemberCountFloor,
    getForcedMinimumMemberCount,
    shouldIncludeBotInMemberCount,
    normalizeLineMembersCountForDisplay
};
