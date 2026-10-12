<script lang="ts">
  export let paused = false;

  const buildings = [
    { x: 240, y: 170, height: 82, color: "mint", mark: "</>" },
    { x: 365, y: 230, height: 116, color: "blue", mark: "✦" },
    { x: 490, y: 292, height: 64, color: "peach", mark: "…" },
    { x: 145, y: 280, height: 56, color: "peach", mark: "⌘" },
    { x: 270, y: 342, height: 90, color: "blue", mark: "≡" },
  ];
  const agents = Array.from({ length: 12 }, (_, i) => ({
    x: 160 + (i % 4) * 65 - Math.floor(i / 4) * 48,
    y: 220 + (i % 4) * 32.5 + Math.floor(i / 4) * 24,
    color: ["mint", "blue", "peach"][i % 3],
    duration: 10 + i % 5 * 2,
    delay: -i * 2.7,
    direction: i % 2 ? -1 : 1,
  }));
</script>

<div class="startup-city" class:paused aria-hidden="true">
  <svg viewBox="0 0 680 490" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse class="startup-city-shadow" cx="340" cy="426" rx="240" ry="28" />
    <path class="startup-city-base-side" d="M60 265 340 125 620 265V282L340 422 60 282Z" />
    <path class="startup-city-ground" d="M60 265 340 125 620 265 340 405Z" />
    <path class="startup-city-road" d="m104 287 280-140m-175 192 280-140M104 243l280 140m-175-192 280 140" />
    <path class="startup-city-road-line" d="m104 287 280-140m-175 192 280-140M104 243l280 140m-175-192 280 140" />
    {#each [ [100,258], [310,154], [560,268], [449,356], [335,389], [190,315] ] as tree}
      <g transform={`translate(${tree[0]} ${tree[1]})`}>
        <ellipse class="startup-city-shadow" rx="14" ry="6" />
        <path class="startup-city-trunk" d="M0 0v-20" />
        <path class="startup-city-tree" d="m0-56 15 28H8l11 15h-38l11-15h-7Z" />
      </g>
    {/each}
    {#each buildings as building}
      <g transform={`translate(${building.x} ${building.y})`} class={`startup-city-building ${building.color}`}>
        <path class="startup-city-building-left" d={`M-35 0 0 18V${18-building.height}L-35 ${-building.height}Z`} />
        <path class="startup-city-building-right" d={`M0 18 35 0V${-building.height}L0 ${18-building.height}Z`} />
        <path class="startup-city-roof" d={`M-35 ${-building.height} 0 ${-18-building.height} 35 ${-building.height} 0 ${18-building.height}Z`} />
        {#each [0,1,2] as row}
          <path class="startup-city-window" d={`M7 ${7-row*18}v-8l8-4v8Zm15-8v-8l8-4v8`} />
        {/each}
        <text class="startup-city-sign" transform={`translate(-17 ${-building.height+29}) skewY(27)`} text-anchor="middle">{building.mark}</text>
        <path class="startup-city-aerial" d={`M0 ${-building.height-18}v-17`} />
        <circle class="startup-city-beacon" cy={-building.height-38} r="3" />
      </g>
    {/each}
    <g transform="translate(416 332)">
      <ellipse class="startup-city-plaza" rx="39" ry="20" />
      <ellipse class="startup-city-plaza-ring" rx="27" ry="13" />
      <path class="startup-city-hub" d="m-11-12 11-6 11 6v22l-11 6-11-6Z" />
      <path class="startup-city-hub-top" d="m-11-12 11-6 11 6-11 6Z" />
      <g class="startup-city-signal"><ellipse cy="-36" rx="18" ry="8" /><ellipse cy="-47" rx="26" ry="12" /></g>
    </g>
    {#each agents as agent, i}
      <g transform={`translate(${agent.x} ${agent.y})`}>
        <g class={`startup-city-walker ${agent.color}`} style={`--walk-time:${agent.duration}s;--walk-delay:${agent.delay}s;--walk-x:${agent.direction*68}px;--walk-y:${agent.direction*34}px`}>
          <ellipse class="startup-city-shadow" cy="2" rx="8" ry="3" />
          <g class="startup-city-agent" style={`--bob-delay:${-i*.13}s`}>
            <path class="startup-city-feet" d="M-4-2v5m8-5v5" />
            <rect class="startup-city-agent-body" x="-7" y="-19" width="14" height="16" rx="5" />
            <rect class="startup-city-face" x="-5" y="-16" width="10" height="6" rx="2" />
            <path class="startup-city-eyes" d="M-2-14v2m4-2v2" />
            <path class="startup-city-aerial" d="M0-19v-4" />
            <circle class="startup-city-agent-body" cy="-24" r="2" />
            {#if i % 3 === 0}<path class="startup-city-parcel" d="M7-9h6v7H7Z" />{/if}
          </g>
        </g>
      </g>
    {/each}
    <g transform="translate(340 419)"><text class="startup-city-caption" text-anchor="middle">MOLIBOT · AGENT CITY</text></g>
  </svg>
</div>
