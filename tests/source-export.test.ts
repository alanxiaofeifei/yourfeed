import {describe,it,expect} from 'vitest';
import {XMLParser} from 'fast-xml-parser';
import {buildSourceExport,sourceOpml,sourcePlatformWarning} from '../shared/source-export';
import type {Source} from '../shared/types';
const source=(overrides:Partial<Source>={}):Source=>({id:'private-internal',name:'Science & <stuff>',platform:'rss',locator:'https://science.reader.net/feed?a=1&b=2',topics:['science'],enabled:false,...overrides});
describe('portable source exports',()=>{
 it('roundtrips OPML special characters and only exports feed subscriptions',()=>{
  const rss=source(),result=sourceOpml([rss,source({platform:'github',locator:'reader'})],new Date('2026-11-11T00:00:00Z'));
  const opml=new XMLParser({ignoreAttributes:false}).parse(result.text);expect(opml.opml.body.outline['@_text']).toBe(rss.name);expect(opml.opml.body.outline['@_xmlUrl']).toBe(rss.locator);expect(result.included).toBe(1);expect(result.omitted).toBe(1);
 });
 it('whitelists portable JSON data and never exports internal identities or secrets',()=>{
  const json=buildSourceExport([{...source(),apiKey:'do-not-export',_identityKey:'internal'} as Source]);
  expect(json.sources[0]).toEqual({name:'Science & <stuff>',platform:'rss',locator:'https://science.reader.net/feed?a=1&b=2',topics:['science'],enabled:false});expect(JSON.stringify(json)).not.toContain('private-internal');expect(JSON.stringify(json)).not.toContain('do-not-export');
 });
 it('omits credential and account-action URLs rather than exporting a private feed token',()=>{
  const result=buildSourceExport([source({locator:'https://feed.reader.net/rss?token=not-public'}),source({locator:'https://feed.reader.net/unsubscribe'}),source({locator:'https://user:password@feed.reader.net/rss'}),source()]);expect(result.omitted).toBe(3);expect(result.sources).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('not-public');
 });
 it('flags Reddit RSS but not original post links or unrelated suffix hosts',()=>{
  expect(sourcePlatformWarning(source({locator:'https://www.reddit.com/r/science/.rss'}))).toBe('reddit-rss-ending');expect(sourcePlatformWarning(source({platform:'web',locator:'https://www.reddit.com/r/science/post'}))).toBeUndefined();expect(sourcePlatformWarning(source({locator:'https://notreddit.com/r/science/.rss'}))).toBeUndefined();
 });
});
