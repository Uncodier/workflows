// Ownership is set by the API on insert. Role, approval and delivery state do
// not identify the sender (and legacy workflow proposals have no owner key).
export const CHAT_INTERVENTION = 'chat_intervention';
export const workflowOwnerFilter =
  `custom_data->>dispatch_owner.is.null,custom_data->>dispatch_owner.neq.${CHAT_INTERVENTION}`;