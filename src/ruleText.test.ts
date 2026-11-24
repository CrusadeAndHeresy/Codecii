import { describe, expect, it } from 'vitest';
import { splitIntro } from './ruleText';

describe('splitIntro', () => {
  it('moves a background paragraph out of the way of the rule', () => {
    const full = 'Some weapons are wreathed in flame emitted from small projectors, stirring a primaeval aversion in the boldest warriors.\n\nA Weapon with this Special Rule causes additional modifiers to a Target\'s Leadership Characteristic.';
    const r = splitIntro('A Weapon with Aflame (X) causes additional modifiers to a Target\'s Leadership Characteristic.', full);
    expect(r.intro).toHaveLength(1);
    expect(r.body[0]).toMatch(/^A Weapon with this Special Rule/);
  });
  it('leaves a rule alone when it starts with the rule itself', () => {
    const full = 'If a Model has a Caedere weapon as part of its Wargear, you can select one of the following for that Model.\n\n• Meteor hammer\n• Excoriator chainaxe';
    const r = splitIntro('A Model with a Caedere weapon picks one weapon from a list.', full);
    expect(r.intro).toHaveLength(0);
    expect(r.body).toHaveLength(2);
  });
  it('does nothing without a summary or with one paragraph', () => {
    expect(splitIntro(undefined, 'One.\n\nTwo.').intro).toHaveLength(0);
    expect(splitIntro('x', 'Only one paragraph here.').intro).toHaveLength(0);
  });
});

describe('splitIntro, same-paragraph and multi-paragraph background', () => {
  it('strips two leading background paragraphs before the matched rule', () => {
    const full = 'Each Legion maintains the military tradition of the battle standard, carried into war as a symbol of honour.\n\nLegion standards are borne by the most trusted warriors of the host in every campaign.\n\nA Model with this Special Rule adds +1 to the Combat Resolution Points of its unit.';
    const r = splitIntro('A Model with this Special Rule adds +1 to the Combat Resolution Points of its unit.', full);
    expect(r.body).toEqual([full.split('\n\n')[2]]);
    expect(r.intro.length).toBe(2);
  });
  it('keeps everything when the first paragraph is a real rule', () => {
    const full = 'A Model with this Special Rule may re-roll 1 failed Armour Save per Phase.\n\nThis cannot be combined with other re-rolls.';
    expect(splitIntro('May re-roll one failed Armour Save per Phase.', full).intro).toEqual([]);
  });
});
