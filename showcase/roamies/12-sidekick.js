// The chosen sidekick: the LED matrix dither blob, without the drips, with the agent layer on top.
Roamie.register(Roamie.ditherKit({
  id: 'sidekick', label: 'Sidekick', matrix: true, pixel: 1.3, glow: 0.55, speed: 80,
  pal: [[14, 4, 18], [71, 14, 96], [196, 40, 149], [255, 120, 214], [255, 230, 247]],
  plugin: (kit) => Roamie.agentPlugin?.(kit) ?? null,
}));
