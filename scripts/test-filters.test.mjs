import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilters, filterParams, rpcFilters } from '../app/modules/filters.js';

test('territories use all requested departments and server pagination', () => {
  const filters = rpcFilters(readFilters('?sector=avignon&page=2&tel=À+rappeler&need=GMB&blocker=Budget'));
  assert.deepEqual(filters.p_departments, [84,13,30,34,26]);
  assert.equal(filters.p_offset, 50);
  assert.equal(filters.p_limit, 50);
  assert.equal(filters.p_issue_tel, 'À rappeler');
  assert.equal(filters.p_need, 'GMB'); assert.equal(filters.p_blocker, 'Budget');
});
test('filters survive URL round trip including accents', () => {
  const state = readFilters('?sector=reunion&rdv=__empty&q=électricité&profession=Plombier');
  assert.deepEqual(readFilters(filterParams(state)), state);
  assert.deepEqual(rpcFilters(state).p_departments, [974]);
});
test('invalid filter values fall back safely', () => {
  const state = readFilters('?sector=bad&page=-5&sort=DROP&dept=2A&tel=invalid&priority=bad');
  assert.equal(state.page, 1); assert.equal(state.sector, ''); assert.equal(state.sort, 'societe');
  assert.equal(state.tel, ''); assert.equal(state.priority, ''); assert.equal(state.dept, '');
});
test('unset issues are distinct from no filter', () => {
  assert.equal(rpcFilters(readFilters('?tel=__empty')).p_issue_tel, '__empty');
  assert.equal(rpcFilters(readFilters('')).p_issue_tel, null);
});
test('department and sector intersect rather than silently overriding each other', () => {
  const rpc = rpcFilters(readFilters('?sector=alpes&dept=06'));
  assert.deepEqual(rpc.p_departments, [6,83,4]); assert.equal(rpc.p_departement, 6);
});
test('other territory excludes every named region', () => {
  const rpc = rpcFilters(readFilters('?sector=other'));
  assert.equal(rpc.p_departments, null);
  assert.deepEqual(rpc.p_excluded_departments, [84,13,30,34,26,20,974,69,1,38,42,6,83,4]);
});
test('invalid need and blocker values are ignored', () => {
  const state = readFilters('?need=Invented&blocker=Unknown&historyRdv=Bad');
  assert.equal(state.need, ''); assert.equal(state.blocker, ''); assert.equal(state.historyRdv, '');
});
