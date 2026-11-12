'use strict';

// 浏览器兼容桥：账号版和分享版使用同一份纯业务规则。
const { teamCalendarFormatter, TEAM_APPOINTMENT_LABELS, TEAM_CARE_START_DAY, TEAM_CARE_LAST_NURSING_DAY, TEAM_CARE_LAST_DAY, teamCareFollowupDate, teamCarePhase, teamCareProductMatches, teamLatestCompletedNails, teamCareReminderKey, teamCalendarTime, teamBusinessClock, teamDaysBetween, teamMemberRecency, teamHasRecentContact, teamContactBlockers, teamNextMemberNumber, teamFormatMemberNumber, teamWorkspaceSnapshot, teamLatestScheduledAppointments, teamAppointmentPending, teamTaskNeedsHandoff, teamTaskBelongsTo, teamValidDate, teamTodoReasons } = globalThis.NailMateTeamRules;
