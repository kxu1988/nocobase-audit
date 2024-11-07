/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Context } from '@nocobase/actions';
import Stream from 'stream';

function isStream(obj) {
  return (
    obj instanceof Stream.Readable ||
    obj instanceof Stream.Writable ||
    obj instanceof Stream.Duplex ||
    obj instanceof Stream.Transform
  );
}

export interface AuditLog {
  uuid: string;
  dataSource: string;
  resource: string;
  collection?: string;
  association?: string;
  action: string;
  resourceUk: string;
  userId: string;
  roleName: string;
  ip: string;
  ua: string;
  status: number;
  metadata: Record<string, any>;
}

export interface AuditLogger {
  log(auditLog: AuditLog): Promise<void>;
}

type Action =
  | string
  | {
      name: string;
      // 在操作上下文中获取 MetaData
      getMetaData?: (ctx: Context) => Promise<Record<string, any>>;
      getUserInfo?: (ctx: Context) => Promise<Record<string, any>>;
    };

export class AuditManager {
  logger: AuditLogger;
  resources: Map<string, Map<string, Action>>; // 不一定是这个类型，根据存取方便处理

  constructor() {
    this.resources = new Map();
  }

  public setLogger(logger: AuditLogger) {
    this.logger = logger;
  }
  /**
   * 注册需要参与审计的资源和操作，支持几种写法
   *
   * 对所有资源生效；
   * registerActions(['create'])
   *
   * 对某个资源的所有操作生效 resource:*
   * registerActions(['app:*'])
   *
   * 对某个资源的某个操作生效 resouce:action
   * registerAction(['pm:update'])
   *
   * 支持传getMetaData方法
   *
   * registerActions([
   *  'create',
   *  { name: 'auth:signIn', getMetaData}
   * ])
   *
   * 支持传getUserInfo方法
   *
   * registerActions([
   * 'create',
   * { name: 'auth:signIn', getUserInfo }
   * ])
   *
   * 当注册的接口有重叠时，颗粒度细的注册方法优先级更高
   *
   * Action1: registerActions(['create']);
   *
   * Action2: registerAction([{ name: 'user:*', getMetaData }]);
   *
   * Action3: registerAction([{ name: 'user:create', getMetaData }]);
   *
   * 对于user:create接口，以上优先级顺序是 Action3 > Action2 > Action1
   *
   * @param actions 操作列表
   */
  registerActions(actions: Action[]) {
    actions.forEach((action) => {
      this.registerAction(action);
    });
  }

  /**
   * 注册单个操作，支持的用法同registerActions
   * @param action 操作
   */
  registerAction(action: Action) {
    let originAction = '';
    let getMetaData = null;
    let getUserInfo = null;
    if (typeof action === 'string') {
      originAction = action;
    } else {
      originAction = action.name;
      getMetaData = action.getMetaData;
      getUserInfo = action.getUserInfo;
    }
    // 解析originAction, 获取actionName, resourceName
    const nameRegex = /^[a-zA-Z0-9_-]+$/;
    const resourceWildcardRegex = /^([a-zA-Z0-9_-]+):\*$/;
    const resourceAndActionRegex = /^([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/;
    let resourceName = '';
    let actionName = '';
    if (nameRegex.test(originAction)) {
      actionName = originAction;
      resourceName = '__default__';
    }
    if (resourceWildcardRegex.test(originAction)) {
      const match = originAction.match(resourceWildcardRegex);
      resourceName = match[1];
      actionName = '__default__';
    }
    if (resourceAndActionRegex.test(originAction)) {
      const match = originAction.match(resourceAndActionRegex);
      resourceName = match[1];
      actionName = match[2];
    }
    if (!resourceName && !actionName) {
      return;
    }
    let resource = this.resources.get(resourceName);
    if (!resource) {
      resource = new Map();
      this.resources.set(resourceName, resource);
    }
    const saveAction: Action = {
      name: originAction,
    };
    if (getMetaData) {
      saveAction.getMetaData = getMetaData;
    }
    if (getUserInfo) {
      saveAction.getUserInfo = getUserInfo;
    }
    resource.set(actionName, saveAction);
  }

  getAction(action: string, resource?: string) {
    let resourceName = resource;
    if (!resource) {
      resourceName = '__default__';
    }
    if (resourceName === '__default__') {
      const resourceActions = this.resources.get(resourceName);
      if (resourceActions) {
        const resourceAction = resourceActions.get(action);
        if (resourceAction) {
          return resourceAction;
        }
      }
    } else {
      const resourceActions = this.resources.get(resourceName);
      if (resourceActions) {
        let resourceAction = resourceActions.get(action);
        if (resourceAction) {
          return resourceAction;
        } else {
          resourceAction = resourceActions.get('__default__');
          if (resourceAction) {
            return resourceAction;
          }
        }
      } else {
        const resourceActions = this.resources.get('__default__');
        if (resourceActions) {
          const resourceAction = resourceActions.get(action);
          if (resourceAction) {
            return resourceAction;
          }
        }
      }
    }
    return null;
  }

  async getDefaultMetaData(ctx: any) {
    let body: any = null;
    if (ctx.body) {
      if (!Buffer.isBuffer(ctx.body) && !isStream(ctx.body)) {
        body = ctx.body;
      }
    }
    return {
      request: {
        params: ctx.request.params,
        query: ctx.request.query,
        body: ctx.request.body,
      },
      response: {
        body,
      },
    };
  }

  formatAuditData(ctx: Context) {
    const { resourceName } = ctx.action;
    let association = '';
    let collection = '';
    if (resourceName) {
      const resourceArray = resourceName.split('.');
      if (resourceArray.length > 1) {
        collection = resourceArray[0];
        association = resourceArray[1];
      } else {
        collection = resourceName;
      }
    }
    const resourceUk: string = this.formatResourceUk(ctx);

    const auditLog: AuditLog = {
      uuid: ctx.reqId,
      dataSource: (ctx.request.header['x-data-source'] || 'main') as string,
      resource: resourceName,
      association: association,
      collection: collection,
      action: ctx.action.actionName,
      resourceUk: resourceUk,
      userId: ctx.state?.currentUser?.id,
      roleName: ctx.state?.currentRole,
      ip: ctx.request.ip,
      ua: ctx.request.header['user-agent'],
      status: ctx.response.status,
      metadata: null,
    };
    return auditLog;
  }

  formatResourceUk(ctx: any) {
    const { filterByTk, filterKeys } = ctx.action.params;
    let resourceUk = '';

    if (filterByTk) {
      resourceUk = filterByTk;
    }

    if (filterKeys && filterKeys.length > 0) {
      resourceUk = filterKeys.join(',');
    }

    return resourceUk;
  }

  async output(ctx: any, reqId: any, status: number, metadata?: Record<string, any>) {
    try {
      const { resourceName, actionName } = ctx.action;
      const action: Action = this.getAction(actionName, resourceName);
      if (!action) {
        return;
      }
      const auditLog: AuditLog = this.formatAuditData(ctx);
      auditLog.uuid = reqId;
      auditLog.status = status;
      if (typeof action !== 'string') {
        if (action.getUserInfo) {
          const userInfo = await action.getUserInfo(ctx);
          if (userInfo) {
            if (userInfo.id) {
              auditLog.userId = userInfo.id;
            }
            if (userInfo.roleName) {
              auditLog.roleName = userInfo.roleName;
            }
          }
        }
        if (action.getMetaData) {
          const extra = await action.getMetaData(ctx);
          auditLog.metadata = { ...metadata, ...extra };
        } else {
          const defaultMetaData = await this.getDefaultMetaData(ctx);
          auditLog.metadata = { ...metadata, ...defaultMetaData };
        }
      } else {
        const defaultMetaData = await this.getDefaultMetaData(ctx);
        auditLog.metadata = { ...metadata, ...defaultMetaData };
      }
      this.logger.log(auditLog);
    } catch (err) {
      ctx.log?.error('audit output error: ' + err.message);
    }
  }
  // 中间件
  middleware() {
    return async (ctx: any, next: any) => {
      const reqId = ctx.reqId;
      let status = 1;
      let metadata = {};
      try {
        await next();
      } catch (err) {
        // 操作失败的时候
        // HTTP相应状态码和error message 放到 metadata
        metadata = {
          status: ctx.status,
          errMsg: err.message,
        };
        status = 0;
        throw err;
      } finally {
        if (this.logger) {
          this.output(ctx, reqId, status, metadata);
        }
      }
    };
  }
}
