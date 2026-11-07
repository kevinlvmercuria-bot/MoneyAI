function initialUI() {
    return {
        saving: false,
        selectedModel: '',
        selectedCopyStyle: 'friendly',
        studioMemberId: 'M0001',
        studioObjective: 'wake',
        studioProductId: null,
        copyEdits: new Map(),
        manualDrafts: new Map(),
        generationErrors: [],
        careDrafts: new Map(),
        noteDrafts: new Map(),
        editNoteId: null,
        view: 'dashboard',
        filter: 'all',
        search: '',
        page: 1,
        taskFilter: 'all',
        profileMemberId: 'M0001',
        memberDetailsCache: new Map(),
        memberDetailsLoading: new Set(),
        selectedOpportunity: 'all',
        reportGoal: 'all',
        planLimit: 3,
        productSearch: '',
        productFilter: 'all',
        productsWithoutImage: false,
        productPage: 1,
        selectedTaskId: null,
    };
}
export const state = {
    members: [],
    tasks: [],
    logs: [],
    careRecords: [],
    products: [],
    dataSource: {},
    copyDrafts: [],
    aiConfig: { models: [], configured: false },
    ...initialUI(),
};
export function resetInterfaceState() {
    Object.assign(state, initialUI());
    state.studioMemberId = state.members[0]?.id || null;
    state.profileMemberId = state.members[0]?.id || null;
    state.selectedModel = state.aiConfig.defaultModel || '';
    state.selectedCopyStyle = state.aiConfig.defaultStyle || 'friendly';
}

function applyState(snapshot) {
    const previousSource = state.dataSource.sourceHash;
    ({
        members: state.members,
        tasks: state.tasks,
        logs: state.logs,
        careRecords: state.careRecords = [],
        products: state.products = [],
        dataSource: state.dataSource = {},
        copyDrafts: state.copyDrafts = [],
        ai: state.aiConfig = { models: [], configured: false },
    } = snapshot);
    if (previousSource !== state.dataSource.sourceHash) state.memberDetailsCache.clear();
    if (!state.aiConfig.models.some((model) => model.id === state.selectedModel))
        state.selectedModel = state.aiConfig.defaultModel || '';
    if (!state.aiConfig.styles?.some((style) => style.id === state.selectedCopyStyle))
        state.selectedCopyStyle = state.aiConfig.defaultStyle || 'friendly';
}

export { applyState };
