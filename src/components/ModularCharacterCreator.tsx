import React, { useId, useState } from 'react';
import { Dices, Download, Lock, Sparkles, Unlock } from 'lucide-react';
import {
  ACCESSORY_OPTIONS,
  AppearanceLocks,
  BOTTOM_STYLE_OPTIONS,
  CLOTHING_COLOR_OPTIONS,
  CLOTHING_STYLE_OPTIONS,
  DEFAULT_APPEARANCE,
  describeAppearance,
  EYE_COLOR_OPTIONS,
  FACIAL_HAIR_OPTIONS,
  FOOTWEAR_COLOR_OPTIONS,
  GENDER_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  randomizeAppearance,
  randomizeSingleTrait,
  SKIN_TONE_OPTIONS,
  TraitOption,
  TRIM_COLOR_OPTIONS,
} from '../engine/characterGenerator';
import type { CharacterAppearance } from '../engine/types';

interface ModularCharacterCreatorProps {
  characterId: string;
  characterName: string;
  appearance: CharacterAppearance;
  spriteDataUrl?: string;
  onChangeAppearance: (next: CharacterAppearance) => void;
  onSurpriseFullCharacter: () => void;
}

interface TraitActionButtonsProps {
  label: string;
  locked: boolean;
  onToggleLock: () => void;
  onRoll: () => void;
}

const TraitActionButtons: React.FC<TraitActionButtonsProps> = ({
  label,
  locked,
  onToggleLock,
  onRoll,
}) => (
  <span className="inline-flex items-center gap-1">
    <button
      type="button"
      onClick={onRoll}
      disabled={locked}
      title={`Randomize ${label}`}
      aria-label={`Randomize ${label}`}
      className="rounded border border-borderFolk bg-card p-1 text-muted hover:text-ink disabled:opacity-35"
    >
      <Dices className="h-3 w-3" />
    </button>
    <button
      type="button"
      onClick={onToggleLock}
      aria-pressed={locked}
      title={locked ? `Unlock ${label}` : `Lock ${label} during randomize`}
      aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
      className={`rounded border p-1 transition ${
        locked
          ? 'border-crimson bg-crimson/15 text-crimson'
          : 'border-borderFolk bg-card text-muted hover:text-ink'
      }`}
    >
      {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
    </button>
  </span>
);

function SwatchFieldset<T extends string>({
  groupName,
  legend,
  options,
  value,
  locked,
  onChange,
  onToggleLock,
  onRoll,
}: {
  groupName: string;
  legend: string;
  options: readonly TraitOption<T>[];
  value: T;
  locked: boolean;
  onChange: (val: T) => void;
  onToggleLock: () => void;
  onRoll: () => void;
}) {
  const uid = useId();
  const activeOption = options.find((o) => o.id === value);

  return (
    <fieldset className="rounded-md border border-borderFolk bg-surface/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted px-0.5">
          {legend}
          {activeOption ? (
            <span className="ml-1.5 font-normal normal-case text-ink">· {activeOption.label}</span>
          ) : null}
        </legend>
        <TraitActionButtons
          label={legend}
          locked={locked}
          onToggleLock={onToggleLock}
          onRoll={onRoll}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const inputId = `${uid}-${groupName}-${opt.id}`;
          const checked = opt.id === value;
          return (
            <label
              key={opt.id}
              htmlFor={inputId}
              title={opt.label}
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                id={inputId}
                type="radio"
                name={`${uid}-${groupName}`}
                value={opt.id}
                checked={checked}
                onChange={() => onChange(opt.id)}
                className="visually-hidden swatch-radio"
              />
              <span
                className={`swatch-chip inline-flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                  checked
                    ? 'scale-110 border-crimson ring-2 ring-crimson/30'
                    : 'border-black/25 hover:scale-105'
                }`}
                style={{ backgroundColor: opt.hex ?? '#888' }}
                aria-hidden="true"
              >
                {checked && (
                  <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
                )}
              </span>
              <span className="visually-hidden">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RadioPillFieldset<T extends string>({
  groupName,
  legend,
  options,
  value,
  locked,
  onChange,
  onToggleLock,
  onRoll,
}: {
  groupName: string;
  legend: string;
  options: readonly TraitOption<T>[];
  value: T;
  locked: boolean;
  onChange: (val: T) => void;
  onToggleLock: () => void;
  onRoll: () => void;
}) {
  const uid = useId();

  return (
    <fieldset className="rounded-md border border-borderFolk bg-surface/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted px-0.5">
          {legend}
        </legend>
        <TraitActionButtons
          label={legend}
          locked={locked}
          onToggleLock={onToggleLock}
          onRoll={onRoll}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const inputId = `${uid}-${groupName}-${opt.id}`;
          const checked = opt.id === value;
          return (
            <label
              key={opt.id}
              htmlFor={inputId}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition ${
                checked
                  ? 'border-crimson bg-crimson/12 font-semibold text-ink'
                  : 'border-borderFolk bg-card text-muted hover:border-crimson/40 hover:text-ink'
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={`${uid}-${groupName}`}
                value={opt.id}
                checked={checked}
                onChange={() => onChange(opt.id)}
                className="h-3 w-3"
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SelectTraitField<T extends string>({
  id,
  label,
  options,
  value,
  locked,
  onChange,
  onToggleLock,
  onRoll,
}: {
  id: string;
  label: string;
  options: readonly TraitOption<T>[];
  value: T;
  locked: boolean;
  onChange: (val: T) => void;
  onToggleLock: () => void;
  onRoll: () => void;
}) {
  return (
    <div className="rounded-md border border-borderFolk bg-surface/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
        <TraitActionButtons
          label={label}
          locked={locked}
          onToggleLock={onToggleLock}
          onRoll={onRoll}
        />
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded border border-borderFolk bg-card px-2 py-1.5 text-xs"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export const ModularCharacterCreator: React.FC<ModularCharacterCreatorProps> = ({
  characterId,
  characterName,
  appearance,
  spriteDataUrl,
  onChangeAppearance,
  onSurpriseFullCharacter,
}) => {
  const [locks, setLocks] = useState<AppearanceLocks>({});

  const toggleLock = (trait: keyof CharacterAppearance) => {
    setLocks((prev) => ({ ...prev, [trait]: !prev[trait] }));
  };

  const rollTrait = (trait: keyof CharacterAppearance) => {
    onChangeAppearance(randomizeSingleTrait(appearance, trait));
  };

  const rollAllUnlocked = () => {
    onChangeAppearance(randomizeAppearance({ base: appearance, locks }));
  };

  const lockCount = Object.values(locks).filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Studio Toolbar + Live 4x4 Generated Spritesheet Preview */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borderFolk bg-surface p-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {spriteDataUrl && (
            <div className="shrink-0 rounded border border-borderFolk bg-linen p-1">
              <img
                src={spriteDataUrl}
                alt={`Generated 4x4 spritesheet for ${characterName}`}
                width={64}
                height={64}
                className="pixel-canvas block h-16 w-16"
              />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold">Modular Pixel Sprite Studio (128×128 PNG)</div>
            <p className="text-[11px] text-muted leading-snug capitalize">
              {describeAppearance(appearance)}.
            </p>
            {lockCount > 0 && (
              <button
                type="button"
                onClick={() => setLocks({})}
                className="mt-1 text-[10px] font-medium text-crimson hover:underline"
              >
                Unlock {lockCount} locked trait{lockCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={rollAllUnlocked}
            className="inline-flex items-center gap-1.5 rounded bg-crimson px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-95"
          >
            <Dices className="h-3.5 w-3.5" />
            <span>Randomize Look</span>
          </button>
          <button
            type="button"
            onClick={onSurpriseFullCharacter}
            title="Auto-generate new visual traits, folk name, persona bio, and voice"
            className="inline-flex items-center gap-1.5 rounded border border-indigoFolk bg-indigoFolk/10 px-2.5 py-1.5 text-xs font-semibold text-indigoFolk hover:bg-indigoFolk/20"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Surprise Full Character</span>
          </button>
          {spriteDataUrl && (
            <a
              href={spriteDataUrl}
              download={`${characterName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'villager'}-spritesheet-128x128.png`}
              className="inline-flex items-center gap-1 rounded border border-borderFolk bg-card px-2 py-1.5 text-xs hover:bg-linen"
              title="Download generated 128x128 4x4 spritesheet PNG"
            >
              <Download className="h-3.5 w-3.5" />
              <span>PNG</span>
            </a>
          )}
        </div>
      </div>

      {/* Modular Trait Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <RadioPillFieldset
          groupName={`gender-${characterId}`}
          legend="Gender / Silhouette"
          options={GENDER_OPTIONS}
          value={appearance.gender}
          locked={!!locks.gender}
          onChange={(gender) => onChangeAppearance({ ...appearance, gender })}
          onToggleLock={() => toggleLock('gender')}
          onRoll={() => rollTrait('gender')}
        />

        <RadioPillFieldset
          groupName={`facial-hair-${characterId}`}
          legend="Facial Hair"
          options={FACIAL_HAIR_OPTIONS}
          value={appearance.facialHair}
          locked={!!locks.facialHair}
          onChange={(facialHair) => onChangeAppearance({ ...appearance, facialHair })}
          onToggleLock={() => toggleLock('facialHair')}
          onRoll={() => rollTrait('facialHair')}
        />

        <SwatchFieldset
          groupName={`skin-${characterId}`}
          legend="Skin Tone"
          options={SKIN_TONE_OPTIONS}
          value={appearance.skinTone}
          locked={!!locks.skinTone}
          onChange={(skinTone) => onChangeAppearance({ ...appearance, skinTone })}
          onToggleLock={() => toggleLock('skinTone')}
          onRoll={() => rollTrait('skinTone')}
        />

        <SwatchFieldset
          groupName={`eyes-${characterId}`}
          legend="Eye Color"
          options={EYE_COLOR_OPTIONS}
          value={appearance.eyeColor}
          locked={!!locks.eyeColor}
          onChange={(eyeColor) => onChangeAppearance({ ...appearance, eyeColor })}
          onToggleLock={() => toggleLock('eyeColor')}
          onRoll={() => rollTrait('eyeColor')}
        />

        <SelectTraitField
          id={`mod-hair-style-${characterId}`}
          label="Hair Style"
          options={HAIR_STYLE_OPTIONS}
          value={appearance.hairStyle}
          locked={!!locks.hairStyle}
          onChange={(hairStyle) => onChangeAppearance({ ...appearance, hairStyle })}
          onToggleLock={() => toggleLock('hairStyle')}
          onRoll={() => rollTrait('hairStyle')}
        />

        <SwatchFieldset
          groupName={`hair-color-${characterId}`}
          legend="Hair Color"
          options={HAIR_COLOR_OPTIONS}
          value={appearance.hairColor}
          locked={!!locks.hairColor}
          onChange={(hairColor) => onChangeAppearance({ ...appearance, hairColor })}
          onToggleLock={() => toggleLock('hairColor')}
          onRoll={() => rollTrait('hairColor')}
        />

        <SelectTraitField
          id={`mod-clothing-style-${characterId}`}
          label="Clothing / Outfit"
          options={CLOTHING_STYLE_OPTIONS}
          value={appearance.clothingStyle}
          locked={!!locks.clothingStyle}
          onChange={(clothingStyle) => onChangeAppearance({ ...appearance, clothingStyle })}
          onToggleLock={() => toggleLock('clothingStyle')}
          onRoll={() => rollTrait('clothingStyle')}
        />

        <SwatchFieldset
          groupName={`clothing-color-${characterId}`}
          legend="Outfit Color"
          options={CLOTHING_COLOR_OPTIONS}
          value={appearance.clothingColor}
          locked={!!locks.clothingColor}
          onChange={(clothingColor) => onChangeAppearance({ ...appearance, clothingColor })}
          onToggleLock={() => toggleLock('clothingColor')}
          onRoll={() => rollTrait('clothingColor')}
        />

        <SwatchFieldset
          groupName={`trim-color-${characterId}`}
          legend="Trim / Embroidery / Apron"
          options={TRIM_COLOR_OPTIONS}
          value={appearance.trimColor}
          locked={!!locks.trimColor}
          onChange={(trimColor) => onChangeAppearance({ ...appearance, trimColor })}
          onToggleLock={() => toggleLock('trimColor')}
          onRoll={() => rollTrait('trimColor')}
        />

        <RadioPillFieldset
          groupName={`bottom-${characterId}`}
          legend="Bottoms Style"
          options={BOTTOM_STYLE_OPTIONS}
          value={appearance.bottomStyle}
          locked={!!locks.bottomStyle}
          onChange={(bottomStyle) => onChangeAppearance({ ...appearance, bottomStyle })}
          onToggleLock={() => toggleLock('bottomStyle')}
          onRoll={() => rollTrait('bottomStyle')}
        />

        <SwatchFieldset
          groupName={`footwear-${characterId}`}
          legend="Boots / Footwear"
          options={FOOTWEAR_COLOR_OPTIONS}
          value={appearance.footwearColor}
          locked={!!locks.footwearColor}
          onChange={(footwearColor) => onChangeAppearance({ ...appearance, footwearColor })}
          onToggleLock={() => toggleLock('footwearColor')}
          onRoll={() => rollTrait('footwearColor')}
        />

        <SelectTraitField
          id={`mod-accessory-${characterId}`}
          label="Headwear / Accessory"
          options={ACCESSORY_OPTIONS}
          value={appearance.accessory}
          locked={!!locks.accessory}
          onChange={(accessory) => onChangeAppearance({ ...appearance, accessory })}
          onToggleLock={() => toggleLock('accessory')}
          onRoll={() => rollTrait('accessory')}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onChangeAppearance({ ...DEFAULT_APPEARANCE })}
          className="text-[11px] text-muted hover:text-ink underline"
        >
          Reset traits to starter look
        </button>
      </div>
    </div>
  );
};
