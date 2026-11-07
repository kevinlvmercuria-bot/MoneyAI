import { canContact } from './rules-client.js';

export const state = {
    members: [],
    tasks: [],
    logs: [],
    careRecords: [],
    products: [],
    dataSource: {},
    careMemberId: null,
    careDrafts: new Map(),
    saving: false,
    copyDrafts: [],
    aiConfig: { models: [], configured: false },
    selectedModel: '',
    selectedMembers: new Set(),
    copyEdits: new Map(),
    generationErrors: [],
    view: 'dashboard',
    filter: 'all',
    search: '',
    page: 1,
    taskFilter: 'all',
    profileMemberId: 'M0001',
    careFilter: 'pending',
    careSearch: '',
    careLimit: 15,
    memberDetailsCache: new Map(),
    memberDetailsLoading: new Set(),
    selectedGoal: 'wake',
    reportGoal: 'all',
    planLimit: 3,
    productSearch: '',
    productFilter: 'all',
    productsWithoutImage: false,
    productPage: 1,
    selectedTaskId: null,
};

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
    for (const id of state.selectedMembers) {
        if (!state.members.some((member) => member.id === id && canContact(member)))
            state.selectedMembers.delete(id);
    }
}

export { applyState };
