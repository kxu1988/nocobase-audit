import _ from 'lodash';
import BaseModel from './base';
import { FieldOptions } from '@nocobase/database';
import * as types from '../interfaces/types';
import { merge } from '../utils';
import { BuildOptions } from 'sequelize';
import { SaveOptions, Utils } from 'sequelize';
import { generateCollectionName } from './collection';

export function generateFieldName(title?: string): string {
  return `f_${Math.random().toString(36).replace('0.', '').slice(-4).padStart(4, '0')}`;
}

export class FieldModel extends BaseModel {

  constructor(values: any = {}, options: any = {}) {
    let data = {
      ...(values.options||{}),
      ...values,
      // ..._.omit(values, 'options'),
    };
    const interfaceType = data.interface;
    if (interfaceType) {
      const { options } = types[interfaceType];
      let args = [options, data];
      // @ts-ignore
      data = merge(...args);
      if (['hasOne', 'hasMany', 'belongsTo', 'belongsToMany'].includes(data.type)) {
        if (!data.name) {
          data.name = generateFieldName();
          if (!data.target) {
            data.target  = generateCollectionName();
          }
        }
        if (!data.target) {
          data.target = ['hasOne', 'belongsTo'].includes(data.type) ? Utils.pluralize(data.name) : data.name;
        }
      }
      if (!data.name) {
        data.name = generateFieldName();
      }
    }
    // @ts-ignore
    super(data, options);
  }

  generateName() {
    this.set('name', generateFieldName());
  }

  setInterface(value) {
    const { options } = types[value];
    let args = [];
    // 如果是新数据或 interface 不相等，interface options 放后
    if (this.isNewRecord || this.get('interface') !== value) {
      args = [this.get(), options];
    } else {
      // 已存在的数据更新，不相等，interface options 放前面
      args = [options, this.get()];
    }
    // @ts-ignore
    const values = merge(...args);
    this.set(values);
  }

  async getOptions(): Promise<FieldOptions> {
    return this.get();
  }

  async migrate(options: any = {}) {
    const collectionName = this.get('collection_name');
    if (!collectionName) {
      return false;
    }
    // 如果 database 未定义，load 出来
    if (!this.database.isDefined(collectionName)) {
      await this.database.getModel('collections').load({where: {name: collectionName}});
    }
    const table = this.database.getTable(collectionName);
    table.addField(await this.getOptions());
    await table.sync({
      force: false,
      alter: {
        drop: false,
      }
    });
  }
}

export default FieldModel;
