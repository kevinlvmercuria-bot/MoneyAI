'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createTaskActions = function (app) {
  async function reassignTask(id,data){
    const previous=app.state.tasks.find(t=>t.task_id===id)?.assignee;
    const assignee=data.get('assignee');
    await app.apiAction('reassign',{id,previous,assignee});
    app.ui.employeeFilter='';
    app.render();
    app.notify(`已改派给 ${assignee}。`);
  }
  async function saveTaskResult(id,data){
    const {expectedRevision,...fields}=Object.fromEntries(data);
    await app.apiAction('result',{id,...fields,expectedRevision:Number(expectedRevision)});
    delete app.ui.taskDrafts[id];
    const task=app.state.tasks.find(item=>item.task_id===id);
    if(app.ui.taskFilter!=='今日待办'||!app.todoReasons(task).length)app.ui.taskFilter='全部';
    app.render();
    app.notify('最新联系结果已保存，历史反馈保留，联系进度已同步更新。');
  }

  return {
    reassignTask,
    saveTaskResult,
  };
};
